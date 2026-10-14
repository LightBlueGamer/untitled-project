import type { Client } from "discord.js";
import { getCache, getPool } from "../database.js";
import { PrestigeBuff } from "../resources/prestigeBuffs.js";
import { EffectOperation, getSkill, Skill, SkillEffect } from "../resources/skills.js";

export default class Player {
    public name: string;
    public readonly id: string;
    protected data: Data;

    private static readonly CACHE_PREFIX = "player:";
    private static readonly CACHE_TTL = 3600;

    constructor(
        name: string,
        id: string,
        data: Partial<Data> = defaultPlayerData,
    ) {
        this.name = name;
        this.id = id;
        this.data = { ...defaultPlayerData, ...data };
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
        while (this.data.experience >= this.xpForNextLevel(this.data.level)) {
            this.data.experience -= this.xpForNextLevel(this.data.level);
            this.data.level += 1;
        }
        const currentLevel = this.data.level;
        const levelsGained = currentLevel - previousLevel;

        return {
            player: this,
            previousLevel,
            currentLevel,
            levelsGained,
            didLevelUp: levelsGained > 0,
        };
    }

    public assignRandomExperienceAndBalance(): ExperienceResult {
        const baseExperience = Math.floor(Math.random() * 26 + 15);
        const baseBalance = Math.floor(Math.random() * 101 + 50);

        const experience = this.applySkills(baseExperience, SkillEffect.Experience);
        const balance = this.applySkills(baseBalance, SkillEffect.Balance);

        const xpResult = this.addExperience(experience);
        this.addBalance(balance);

        return xpResult;
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

    public prestige(): Player {
        this.experience = 0;
        this.level = 1;
        this.data.prestige++;
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
            .filter((skill): skill is Skill => skill !== undefined && skill.effect === effect);

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
        };
    }

    public static async findAll(): Promise<Player[]> {
        const pool = getPool();
        const dbClient = await pool.connect();

        try {
            const result = await dbClient.query<{
                id: string;
                data: StoredPlayerData;
            }>("SELECT id, data FROM players ORDER BY id");

            return result.rows.map(({ id, data }) => {
                const { name, ...playerData } = data;
                return new Player(name ?? id, id, playerData);
            });
        } finally {
            dbClient.release();
        }
    }

    public static async findById(id: string): Promise<Player | null> {
        const cache = getCache();
        const cacheKey = `${Player.CACHE_PREFIX}${id}`;
        const cached = await cache.get(cacheKey);

        if (cached) {
            const entry = JSON.parse(cached) as PlayerCacheEntry;
            return new Player(entry.name, id, entry.data);
        }

        const pool = getPool();
        const dbClient = await pool.connect();

        try {
            const result = await dbClient.query<{ data: StoredPlayerData }>(
                "SELECT data FROM players WHERE id = $1",
                [id],
            );
            const storedData = result.rows[0]?.data;

            if (!storedData) return null;

            const { name, ...data } = storedData;
            const player = new Player(name ?? id, id, data);
            await Player.cachePlayer(cacheKey, player);
            return player;
        } finally {
            dbClient.release();
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
                }>("SELECT data FROM players WHERE id = $1", [id]);
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
                };
            }
        } finally {
            insertClient.release();
        }

        await Player.cachePlayer(cacheKey, newPlayer);
        return newPlayer;
    }

    public async save(): Promise<void> {
        const pool = getPool();
        const dbClient = await pool.connect();

        try {
            await dbClient.query(
                `INSERT INTO players (id, data)
                 VALUES ($1, $2)
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                [
                    this.id,
                    JSON.stringify({ ...this.data, name: this.name }),
                ],
            );
        } finally {
            dbClient.release();
        }

        await Player.cachePlayer(`${Player.CACHE_PREFIX}${this.id}`, this);
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

interface PlayerCacheEntry {
    name: string;
    data: Partial<Data>;
}

interface StoredPlayerData extends Partial<Data> {
    name?: string;
}

export interface Data {
    balance: number;
    experience: number;
    level: number;
    prestige: number;
    experienceMultiplier: number;
    balanceMultiplier: number;
    skills: string[];
    skillPoints: number;
    temp: TemporaryData;
}

export interface TemporaryData {
    prestigeBuffs?: PrestigeBuff[]
};

export interface PlayerResponse extends Data {
    id: string;
    name: string;
}

export const defaultPlayerData: Data = {
    balance: 0,
    experience: 0,
    level: 1,
    prestige: 0,
    experienceMultiplier: 1.00,
    balanceMultiplier: 1.00,
    skills: [],
    skillPoints: 0,
    temp: {}
};

export interface ExperienceResult {
    player: Player;
    previousLevel: number;
    currentLevel: number;
    levelsGained: number;
    didLevelUp: boolean;
}

export interface PrestigeInfo {
    prestigeLevel: number;
    canPrestige: boolean;
    currentRequirement: number;
    nextRequirement: number;
}