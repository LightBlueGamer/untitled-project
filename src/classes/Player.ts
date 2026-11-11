import type { Client } from "discord.js";
import type { PoolClient } from "pg";
import { getCache, getPool } from "../database.js";
import { PrestigeBuff } from "../resources/prestigeBuffs.js";
import { EffectOperation, getSkill, type MessageSkill, type MessageSkillReward, type Skill, SkillEffect } from "../resources/skills.js";
import { loseCompanion, obtainCompanion, type OwnedCompanion } from "../companionStorage.js";
import { applyCompanionBonuses, getCompanion, type Companion } from "../resources/companions.js";

const equipmentSQL = `CASE WHEN jsonb_typeof(players.data->'equippedCompanions') = 'array'
    THEN players.data->'equippedCompanions'
    WHEN players.data->>'equippedCompanion' IS NOT NULL
    THEN jsonb_build_array(players.data->>'equippedCompanion') ELSE '[]'::jsonb END`;

const companionInventoryQuery = `COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('key', pc.companion_key, 'quantity', pc.quantity)
                      ORDER BY pc.companion_key)
     FROM player_companions pc WHERE pc.player_id = p.id), '[]'::jsonb)`;

function progressionExperience(data: Partial<Data>): number {
    let total = Math.max(0, data.experience ?? 0);
    const prestige = Math.max(0, Math.floor(data.prestige ?? 0));
    const level = Math.max(1, Math.floor(data.level ?? 1));
    for (let cycle = 0; cycle <= prestige; cycle++) {
        const cycleLevel = cycle === prestige ? level : 10 * 2 ** cycle;
        for (let currentLevel = 1; currentLevel < cycleLevel; currentLevel++) {
            total += Math.floor(25 + 15 * currentLevel + 50 * Math.pow(1.15, currentLevel - 1));
        }
    }
    return total;
}

export class PlayerConflictError extends Error {
    constructor() {
        super("Player progression changed since it was loaded; reload before saving");
        this.name = "PlayerConflictError";
    }
}

export default class Player {
    public name: string;
    public readonly id: string;
    protected data: Data;
    private savedSkills: string[];
    private savedSkillPoints: number;
    private savedPrestige: number;
    private savedTotalExperience: number;
    private savedEquippedCompanions: string[];
    private requireSkillSnapshot = false;
    private resettingSkills = false;
    private companionInventory: OwnedCompanion[];
    private companionOperation: Promise<void> = Promise.resolve();

    private static readonly CACHE_PREFIX = "player:";
    private static readonly CACHE_TTL = 3600;

    constructor(
        name: string,
        id: string,
        data: Partial<Data> = defaultPlayerData,
        companions: readonly OwnedCompanion[] = [],
    ) {
        this.name = name;
        this.id = id;
        const savedTotalExperience = data.totalExperience ?? data.experience ?? defaultPlayerData.totalExperience;
        this.data = {
            ...defaultPlayerData,
            ...data,
            totalExperience: Math.max(savedTotalExperience, progressionExperience(data)),
        };
        this.data.skills = [...this.data.skills];
        this.companionInventory = companions.map(companion => ({ ...companion }));
        this.savedSkills = [...this.data.skills];
        this.savedSkillPoints = this.data.skillPoints;
        this.savedPrestige = this.data.prestige;
        this.savedTotalExperience = savedTotalExperience;
        this.savedEquippedCompanions = this.equippedCompanions;
    }

    public get balance(): number {
        return this.data.balance;
    }

    public addBalance(amount: number): Player {
        this.assertPositiveAmount(amount);
        this.data.balance += amount;
        return this;
    }

    public subtractBalance(amount: number): Player {
        this.assertPositiveAmount(amount);
        this.assertSufficientBalance(amount);
        this.data.balance -= amount;
        return this;
    }

    public get experience(): number {
        return this.data.experience;
    }

    private set experience(value: number) {
        this.assertNonNegativeAmount(value);
        this.data.experience = value;
    }

    public addExperience(amount: number): ExperienceResult {
        this.assertPositiveAmount(amount);
        const previousLevel = this.data.level;
        this.data.experience += amount;
        this.data.totalExperience += amount;
        while (this.data.experience >= this.xpForNextLevel(this.data.level)) {
            this.data.experience -= this.xpForNextLevel(this.data.level);
            this.data.level += 1;
        }
        const currentLevel = this.data.level;
        const levelsGained = currentLevel - previousLevel;
        const skillPointsGained = levelsGained * applyCompanionBonuses(
            this.applySkills(1, SkillEffect.Skill), "skillPoints", this.activeCompanions,
        );
        if (levelsGained > 0) {
            this.requireSkillSnapshot = true;
            this.data.skillPoints += skillPointsGained;
        }

        return {
            player: this,
            previousLevel,
            currentLevel,
            levelsGained,
            skillPointsGained,
            didLevelUp: levelsGained > 0,
        };
    }

    public addScavengeExperience(baseExperience: number): { experienceAwarded: number; progression: ExperienceResult } {
        this.requireSkillSnapshot = true;
        const experienceAwarded = Math.max(1, Math.floor(applyCompanionBonuses(
            this.applySkills(
                this.applySkills(baseExperience + this.data.prestigeExperienceFlat, SkillEffect.ScavengeExperience),
                SkillEffect.Experience,
            ) * this.experienceMultiplier,
            "experience", this.activeCompanions,
        )));
        return { experienceAwarded, progression: this.addExperience(experienceAwarded) };
    }

    public assignRandomExperienceAndBalance(
        random: (key: string) => number = () => Math.random(),
    ): MessageRewardResult {
        this.requireSkillSnapshot = true;
        const baseExperience = Math.floor(random("baseExperience") * 26 + 15);
        const baseBalance = Math.floor(random("baseBalance") * 101 + 50);
        const regularExperience = applyCompanionBonuses(
            this.applySkills(baseExperience + this.data.prestigeExperienceFlat, SkillEffect.Experience) * this.experienceMultiplier,
            "experience", this.activeCompanions,
        );
        let experience = regularExperience;
        let balance = applyCompanionBonuses(
            this.applySkills(baseBalance + this.data.prestigeBalanceFlat, SkillEffect.Balance) * this.balanceMultiplier,
            "balance", this.activeCompanions,
        );
        let bonusSkillPoints = 0;
        const specialRewards: SpecialReward[] = [];

        for (const key of this.skills) {
            const skill = getSkill(key);
            if (!skill || skill.operation !== EffectOperation.Message) continue;
            const reward = skill.messageReward({
                baseExperience,
                baseBalance,
                regularExperience,
                level: this.level,
                xpRequiredForNextLevel: this.xpForNextLevel(this.level),
                balance: this.balance,
                roll: () => random(key),
            });
            if (!reward) continue;
            const roundedReward = reward.experience === undefined
                ? reward
                : { ...reward, experience: Math.floor(reward.experience) };
            experience += roundedReward.experience ?? 0;
            balance += reward.balance ?? 0;
            bonusSkillPoints += reward.skillPoints ?? 0;
            specialRewards.push({ name: skill.name, ...roundedReward });
        }

        const xpResult = this.addExperience(Math.floor(experience));
        const balanceAwarded = Math.floor(balance);
        this.addBalance(balanceAwarded);
        this.data.skillPoints += bonusSkillPoints;

        return { ...xpResult, bonusSkillPoints, specialRewards, experienceAwarded: Math.floor(experience), balanceAwarded };
    }

    public get level(): number {
        return this.data.level;
    }

    private set level(value: number) {
        this.assertNonNegativeAmount(value);
        this.data.level = value;
    }   

    private assertPositiveAmount(amount: number) {
        if(amount <= 0) throw new Error('Amount must be a positive number');
    }

    private assertNonNegativeAmount(amount: number) {
        if(amount < 0) throw new Error('Amount must be a non-negative number');
    }

    private assertSufficientBalance(amount: number) {
        if (amount > this.data.balance) throw new Error('Insufficient balance');
    }

    public xpForNextLevel(level: number): number {
        if (level < 1) {
            throw new Error('Level must be at least 1');
        }

        return Math.floor(
            25 +
            15 * level +
            50 * Math.pow(1.15, level - 1),
        );
    }

    public get experienceMultiplier(): number {
        return this.data.experienceMultiplier;
    }

    public set experienceMultiplier(value: number) {
        if (value < 1.0) {
            throw new Error('Experience multiplier must be at least 1.0');
        }
        this.data.experienceMultiplier = value;
    }

    public get balanceMultiplier(): number {
        return this.data.balanceMultiplier;
    }

    public set balanceMultiplier(value: number) {
        if (value < 1.0) {
            throw new Error('Balance multiplier must be at least 1.0');
        }
        this.data.balanceMultiplier = value;
    }

    public get prestigeExperienceFlat(): number {
        return this.data.prestigeExperienceFlat;
    }

    public addPrestigeExperienceFlat(amount: number): void {
        this.assertPositiveAmount(amount);
        this.data.prestigeExperienceFlat += amount;
    }

    public get prestigeBalanceFlat(): number {
        return this.data.prestigeBalanceFlat;
    }

    public addPrestigeBalanceFlat(amount: number): void {
        this.assertPositiveAmount(amount);
        this.data.prestigeBalanceFlat += amount;
    }

    public get prestigeCompanionSpawnMultiplier(): number {
        return this.data.prestigeCompanionSpawnMultiplier;
    }

    public addPrestigeCompanionSpawnBonus(amount: number): void {
        this.assertPositiveAmount(amount);
        this.data.prestigeCompanionSpawnMultiplier += amount;
    }

    public get prestigeCompanionRarityMultiplier(): number {
        return this.data.prestigeCompanionRarityMultiplier;
    }

    public addPrestigeCompanionRarityBonus(amount: number): void {
        this.assertPositiveAmount(amount);
        this.data.prestigeCompanionRarityMultiplier += amount;
    }

    public get casinoPayoutMultiplier(): number {
        return this.applySkills(1, SkillEffect.Casino)
            * this.data.prestigeCasinoPayoutMultiplier
            * applyCompanionBonuses(1, "casino", this.activeCompanions);
    }

    public get scavengeWeightMultiplier(): number {
        return this.applySkills(1, SkillEffect.Scavenge);
    }

    public get scavengeCooldownMultiplier(): number {
        return this.applySkills(1, SkillEffect.ScavengeCooldown);
    }

    public get scavengeRarityMultiplier(): number {
        return this.applySkills(1, SkillEffect.ScavengeRarity);
    }

    public get scavengeExtraFindChance(): number {
        return this.applySkills(0, SkillEffect.ScavengeFind);
    }

    public get toolSlots(): number {
        return Math.max(1, Math.floor(this.applySkills(1, SkillEffect.ToolSlots)));
    }

    public get lootboxDropMultiplier(): number {
        return this.applySkills(1, SkillEffect.LootboxDrop) * this.data.prestigeLootboxDropMultiplier;
    }

    public get lootboxRarityMultiplier(): number {
        return this.applySkills(1, SkillEffect.LootboxRarity) * this.data.prestigeLootboxRarityMultiplier;
    }

    public get lootboxRewardMultiplier(): number {
        return this.applySkills(1, SkillEffect.LootboxReward) * this.data.prestigeLootboxRewardMultiplier;
    }

    public get lootboxFindMultiplier(): number {
        return this.applySkills(1, SkillEffect.LootboxFind) * this.data.prestigeLootboxFindMultiplier;
    }

    public addPrestigeLootboxBonus(kind: "drop" | "rarity" | "reward" | "find", amount: number): void {
        this.assertPositiveAmount(amount);
        if (kind === "drop") this.data.prestigeLootboxDropMultiplier += amount;
        else if (kind === "rarity") this.data.prestigeLootboxRarityMultiplier += amount;
        else if (kind === "reward") this.data.prestigeLootboxRewardMultiplier += amount;
        else this.data.prestigeLootboxFindMultiplier += amount;
    }

    public addPrestigeCasinoPayoutBonus(amount: number): void {
        this.assertPositiveAmount(amount);
        this.data.prestigeCasinoPayoutMultiplier += amount;
    }

    public get prestigeInfo(): PrestigeInfo {
        const prestigeLevel = this.data.prestige;
        const currentRequirement = 10 * 2 ** prestigeLevel;

        return {
            prestigeLevel,
            canPrestige: this.level >= currentRequirement,
            currentRequirement,
            nextRequirement: currentRequirement * 2,
        };
    }

    public get prestigeLevel(): number {
        return this.data.prestige;
    }

    private set prestigeLevel(value: number) {
        this.assertNonNegativeAmount(value);
        this.data.prestige = value;
    }

    public prestige(afterReset?: () => void): Player {
        this.experience = 0;
        this.level = 1;
        this.data.skills = [];
        this.data.skillPoints = 0;
        this.requireSkillSnapshot = true;
        this.resettingSkills = true;
        this.data.prestige++;
        afterReset?.();
        this.setEquippedCompanions(this.equippedCompanions.slice(0, this.companionSlots));
        return this;
    }

    public addTemporaryPrestigeBuffData(buffs: PrestigeBuff[] | []) {
        this.data.temp.prestigeBuffs = buffs;
        return this;
    }

    public get hasExistingBuffChoices() {
        return (this.data.temp?.prestigeBuffs?.length ?? 0) > 1;
    }

    public get temporaryPrestigeBuffData() {
        return this.data.temp.prestigeBuffs;
    }

    public clearTemporaryPrestigeBuffData() {
        this.data.temp.prestigeBuffs = [];
        return this;
    }

    public get skills(): string[] {
        return this.data.skills;
    }

    public get companions(): readonly OwnedCompanion[] {
        return this.companionInventory.map(companion => ({ ...companion }));
    }

    public get equippedCompanion(): string | null {
        return this.equippedCompanions[0] ?? null;
    }

    public get equippedCompanions(): string[] {
        return [...(this.data.equippedCompanions ?? (this.data.equippedCompanion ? [this.data.equippedCompanion] : []))];
    }

    public get companionSlots(): number {
        return 1 + (this.data.prestigeCompanionSlot ? 1 : 0) + (this.skills.includes("companion_bond") ? 1 : 0);
    }

    public get hasPrestigeCompanionSlot(): boolean {
        return this.data.prestigeCompanionSlot;
    }

    public grantPrestigeCompanionSlot(): void {
        this.data.prestigeCompanionSlot = true;
    }

    private setEquippedCompanions(keys: string[]): void {
        this.data.equippedCompanions = keys;
        this.data.equippedCompanion = keys[0] ?? null;
    }

    private get activeCompanions(): Companion[] {
        return this.equippedCompanions.map(getCompanion).filter((companion): companion is Companion => companion !== undefined);
    }

    public obtainCompanion(key: string): Promise<number> {
        return this.changeCompanion(key, obtainCompanion);
    }

    public loseCompanion(key: string): Promise<number> {
        return this.changeCompanion(key, loseCompanion);
    }

    private changeCompanion(key: string, change: (playerId: string, key: string) => Promise<number>): Promise<number> {
        const operation = this.companionOperation.then(async () => {
            const quantity = await change(this.id, key);
            this.updateCompanionSnapshot(key, quantity);
            if (change === loseCompanion && quantity === 0 && this.equippedCompanions.includes(key)) {
                this.setEquippedCompanions(this.equippedCompanions.filter(item => item !== key));
                if (!this.requireSkillSnapshot) this.savedEquippedCompanions = this.equippedCompanions;
            }
            return quantity;
        });
        this.companionOperation = operation.then(() => undefined, () => undefined);
        return operation;
    }

    private updateCompanionSnapshot(key: string, quantity: number): void {
        this.companionInventory = this.companionInventory.filter(item => item.key !== key);
        if (quantity > 0) this.companionInventory.push({ key, quantity });
        this.companionInventory.sort((a, b) => a.key.localeCompare(b.key));
    }

    public get skillPoints(): number {
        return this.data.skillPoints;
    }

    public set skillPoints(value: number) {
        this.assertNonNegativeAmount(value);
        this.data.skillPoints = value;
    }

    public set skills(value: string[]) {
        this.data.skills = value;
    }

    public getSkill(skillId: string): Skill {
        const skill = getSkill(skillId);
        if (!skill) {
            throw new Error(`Skill with ID ${skillId} not found`);
        }
        return skill;
    }

    private applySkills(amount: number, effect: SkillEffect): number {
        const unlocked = this.skills
            .map(getSkill)
            .filter((skill): skill is Exclude<Skill, MessageSkill> =>
                skill !== undefined && skill.operation !== EffectOperation.Message && skill.effect === effect);

        let result = amount;

        for (const skill of unlocked.filter((skill) => skill.operation === EffectOperation.Add)) {
            result = skill.skill(result);
        }

        for (const skill of unlocked.filter((skill) => skill.operation === EffectOperation.Multiply)) {
            result = skill.skill(result);
        }

        return result;
    }

    // Do not modify below this line

    public toJSON(): PlayerResponse {
        return {
            id: this.id,
            name: this.name,
            ...this.data,
            equippedCompanion: this.equippedCompanion,
            equippedCompanions: this.equippedCompanions,
            companionSlots: this.companionSlots,
            companions: this.companions,
            scavengeWeightMultiplier: this.scavengeWeightMultiplier,
            scavengeRarityMultiplier: this.scavengeRarityMultiplier,
            scavengeExtraFindChance: this.scavengeExtraFindChance,
            toolSlots: this.toolSlots,
        };
    }

    public static async findAll(): Promise<Player[]> {
        const pool = getPool();
        const dbClient = await pool.connect();

        try {
            const result = await dbClient.query<{
                id: string;
                data: StoredPlayerData;
                companions: OwnedCompanion[];
            }>(`SELECT p.id, p.data, ${companionInventoryQuery} AS companions FROM players p ORDER BY p.id`);

            return result.rows.map(({ id, data, companions }) => {
                const { name, ...playerData } = data;
                return new Player(name ?? id, id, playerData, companions);
            });
        } finally {
            dbClient.release();
        }
    }

    public static async findById(id: string, transactionClient?: PoolClient): Promise<Player | null> {
        const dbClient = transactionClient ?? await getPool().connect();

        try {
            const result = await dbClient.query<{ data: StoredPlayerData; companions: OwnedCompanion[] }>(
                `SELECT p.data, ${companionInventoryQuery} AS companions FROM players p WHERE p.id = $1`,
                [id],
            );
            const storedData = result.rows[0]?.data;

            if (!storedData) return null;

            const { name, ...data } = storedData;
            const player = new Player(name ?? id, id, data, result.rows[0].companions);
            return player;
        } finally {
            if (!transactionClient) dbClient.release();
        }
    }

    public static async get(id: string, discordClient: Client): Promise<Player> {
        const pool = getPool();
        const existingPlayer = await Player.findById(id);

        if (existingPlayer) {
            if (existingPlayer.name === id) {
                existingPlayer.name = (
                    await discordClient.users.fetch(id)
                ).username;
                await Player.cachePlayer(
                    `${Player.CACHE_PREFIX}${id}`,
                    existingPlayer,
                );
            }
            return existingPlayer;
        }

        const name = (await discordClient.users.fetch(id)).username;
        const newPlayer = new Player(name, id);
        const insertClient = await pool.connect();
        const cacheKey = `${Player.CACHE_PREFIX}${id}`;

        try {
            const insertResult = await insertClient.query<{
                data: Partial<Data>;
            }>(
                `INSERT INTO players (id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (id) DO NOTHING
                 RETURNING data`,
                [
                    id,
                    JSON.stringify({
                        ...newPlayer.data,
                        name: newPlayer.name,
                    }),
                ],
            );

            if (!insertResult.rows[0]) {
                const existingResult = await insertClient.query<{
                    data: StoredPlayerData;
                    companions: OwnedCompanion[];
                }>(`SELECT p.data, ${companionInventoryQuery} AS companions FROM players p WHERE p.id = $1`, [id]);
                const existingPlayer = existingResult.rows[0];
                if (!existingPlayer) {
                    throw new Error(
                        `Player ${id} was not found after a concurrent insert`,
                    );
                }
                const { name: storedName, ...data } = existingPlayer.data;
                newPlayer.name = storedName ?? name;
                newPlayer.data = {
                    ...defaultPlayerData,
                    ...data,
                    totalExperience: Math.max(
                        data.totalExperience ?? data.experience ?? defaultPlayerData.totalExperience,
                        progressionExperience(data),
                    ),
                };
                newPlayer.companionInventory = existingPlayer.companions.map(companion => ({ ...companion }));
                newPlayer.savedSkills = [...newPlayer.data.skills];
                newPlayer.savedSkillPoints = newPlayer.data.skillPoints;
                newPlayer.savedPrestige = newPlayer.data.prestige;
                newPlayer.savedTotalExperience = existingPlayer.data.totalExperience
                    ?? existingPlayer.data.experience
                    ?? defaultPlayerData.totalExperience;
                newPlayer.savedEquippedCompanions = newPlayer.equippedCompanions;
            }
        } finally {
            insertClient.release();
        }

        await Player.cachePlayer(cacheKey, newPlayer);
        return newPlayer;
    }

    public async save(transactionClient?: PoolClient): Promise<void> {
        const dbClient = transactionClient ?? await getPool().connect();

        try {
            const skillsChanged = this.resettingSkills || JSON.stringify(this.data.skills) !== JSON.stringify(this.savedSkills);
            const pointsChanged = this.resettingSkills || this.data.skillPoints !== this.savedSkillPoints;
            const totalExperienceChanged = this.data.totalExperience !== this.savedTotalExperience;
            const result = await dbClient.query<{ data: StoredPlayerData }>(
                `INSERT INTO players (id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (id) DO UPDATE SET data =
                     EXCLUDED.data ||
                     CASE WHEN $3::boolean THEN '{}'::jsonb
                          ELSE jsonb_build_object('skills', COALESCE(players.data->'skills', '[]'::jsonb)) END ||
                     CASE WHEN $4::boolean THEN '{}'::jsonb
                          ELSE jsonb_build_object('skillPoints', COALESCE(players.data->'skillPoints', '0'::jsonb)) END
                     || CASE WHEN $10::boolean THEN jsonb_build_object(
                          'equippedCompanions', EXCLUDED.data->'equippedCompanions',
                          'equippedCompanion', COALESCE(EXCLUDED.data->'equippedCompanion', 'null'::jsonb))
                        ELSE jsonb_build_object('equippedCompanions', ${equipmentSQL},
                          'equippedCompanion', COALESCE(${equipmentSQL}->0, 'null'::jsonb)) END
                     || CASE WHEN $11::boolean THEN '{}'::jsonb
                          ELSE jsonb_build_object('totalExperience',
                              COALESCE((players.data->>'totalExperience')::numeric,
                                       (players.data->>'experience')::numeric, 0)) END
                 WHERE (NOT ($3::boolean OR $7::boolean) OR COALESCE(players.data->'skills', '[]'::jsonb) = $5::jsonb)
                   AND (NOT $4::boolean OR COALESCE(players.data->'skillPoints', '0'::jsonb) = $6::jsonb)
                   AND COALESCE((players.data->>'prestige')::numeric, 0) = $8::numeric
                   AND (NOT $7::boolean OR ${equipmentSQL} = $9::jsonb)
                   AND (NOT $11::boolean OR COALESCE((players.data->>'totalExperience')::numeric, (players.data->>'experience')::numeric, 0) = $12::numeric)
                 RETURNING data`,
                [
                    this.id,
                    JSON.stringify({ ...this.data, name: this.name }),
                    skillsChanged,
                    pointsChanged,
                    JSON.stringify(this.savedSkills),
                    JSON.stringify(this.savedSkillPoints),
                    this.requireSkillSnapshot,
                    this.savedPrestige,
                    JSON.stringify(this.savedEquippedCompanions),
                    this.resettingSkills,
                    totalExperienceChanged,
                    this.savedTotalExperience,
                ],
            );
            if (!result.rows[0]) {
                throw new PlayerConflictError();
            }
            const { name, ...data } = result.rows[0].data;
            this.name = name ?? this.name;
            this.data = { ...defaultPlayerData, ...data };
            this.savedSkills = [...this.data.skills];
            this.savedSkillPoints = this.data.skillPoints;
            this.savedPrestige = this.data.prestige;
            this.savedTotalExperience = this.data.totalExperience;
            this.savedEquippedCompanions = this.equippedCompanions;
            this.requireSkillSnapshot = false;
            this.resettingSkills = false;
        } finally {
            if (!transactionClient) dbClient.release();
        }

        if (!transactionClient) await Player.invalidate(this.id);
    }

    public static async invalidate(id: string): Promise<void> {
        const cache = getCache();
        await cache.del(`${Player.CACHE_PREFIX}${id}`);
    }

    public static async exists(id: string): Promise<boolean> {
        const cache = getCache();
        const cacheKey = `${Player.CACHE_PREFIX}${id}`;
        if (await cache.get(cacheKey)) return true;

        const pool = getPool();
        const dbClient = await pool.connect();

        try {
            const result = await dbClient.query(
                "SELECT 1 FROM players WHERE id = $1 LIMIT 1",
                [id],
            );
            return (result.rowCount ?? 0) > 0;
        } finally {
            dbClient.release();
        }
    }

    private static async cachePlayer(
        cacheKey: string,
        player: Player,
    ): Promise<void> {
        const cache = getCache();
        await cache.set(
            cacheKey,
            JSON.stringify({ name: player.name, data: player.data }),
            { EX: Player.CACHE_TTL },
        );
    }
}

interface StoredPlayerData extends Partial<Data> {
    name?: string;
}

export interface Data {
    balance: number;
    experience: number;
    totalExperience: number;
    level: number;
    prestige: number;
    experienceMultiplier: number;
    balanceMultiplier: number;
    prestigeExperienceFlat: number;
    prestigeBalanceFlat: number;
    prestigeCompanionSpawnMultiplier: number;
    prestigeCompanionRarityMultiplier: number;
    prestigeCasinoPayoutMultiplier: number;
    prestigeLootboxDropMultiplier: number;
    prestigeLootboxRarityMultiplier: number;
    prestigeLootboxRewardMultiplier: number;
    prestigeLootboxFindMultiplier: number;
    skills: string[];
    skillPoints: number;
    equippedCompanion: string | null;
    equippedCompanions?: string[];
    prestigeCompanionSlot: boolean;
    temp: TemporaryData;
}

export interface TemporaryData {
    prestigeBuffs?: PrestigeBuff[]
};

export interface PlayerResponse extends Data {
    id: string;
    name: string;
    companions: readonly OwnedCompanion[];
    companionSlots: number;
    scavengeWeightMultiplier: number;
    scavengeRarityMultiplier: number;
    scavengeExtraFindChance: number;
    toolSlots: number;
}

export const defaultPlayerData: Data = {
    balance: 0,
    experience: 0,
    totalExperience: 0,
    level: 1,
    prestige: 0,
    experienceMultiplier: 1.00,
    balanceMultiplier: 1.00,
    prestigeExperienceFlat: 0,
    prestigeBalanceFlat: 0,
    prestigeCompanionSpawnMultiplier: 1,
    prestigeCompanionRarityMultiplier: 1,
    prestigeCasinoPayoutMultiplier: 1,
    prestigeLootboxDropMultiplier: 1,
    prestigeLootboxRarityMultiplier: 1,
    prestigeLootboxRewardMultiplier: 1,
    prestigeLootboxFindMultiplier: 1,
    skills: [],
    skillPoints: 0,
    equippedCompanion: null,
    prestigeCompanionSlot: false,
    temp: {}
};

export interface ExperienceResult {
    player: Player;
    previousLevel: number;
    currentLevel: number;
    levelsGained: number;
    skillPointsGained: number;
    didLevelUp: boolean;
}

export interface SpecialReward extends MessageSkillReward {
    name: string;
}

export interface MessageRewardResult extends ExperienceResult {
    bonusSkillPoints: number;
    specialRewards: SpecialReward[];
    experienceAwarded: number;
    balanceAwarded: number;
}

export interface PrestigeInfo {
    prestigeLevel: number;
    canPrestige: boolean;
    currentRequirement: number;
    nextRequirement: number;
}