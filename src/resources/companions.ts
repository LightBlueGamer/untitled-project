import { Rarity } from "./rarities.js";
import { createAdditionalCompanions } from "./additionalCompanions.js";

export interface CompanionStats {
    readonly HP: number;
    readonly DMG: number;
    readonly DEF: number;
    readonly SPD: number;
    readonly CRIT: number;
}

export type CompanionBonus =
    | { readonly type: "experienceMultiplier"; readonly multiplier: number }
    | { readonly type: "balanceMultiplier"; readonly multiplier: number }
    | { readonly type: "casinoPayoutMultiplier"; readonly multiplier: number }
    | { readonly type: "experienceFlat"; readonly amount: number }
    | { readonly type: "balanceFlat"; readonly amount: number }
    | { readonly type: "skillPointsFlat"; readonly amount: number }
    | { readonly type: "rareEncounterWeightMultiplier"; readonly multiplier: number };

export interface Companion {
    readonly name: string;
    readonly description: string;
    readonly stats: CompanionStats;
    readonly bonus: CompanionBonus;
    readonly rarity: Rarity;
    readonly chanceWeight: number;
}

const catalog: Record<string, Companion> = {
    mossprout: {
        name: "Mossprout",
        description: "A curious seedling that grows brighter as its trainer learns. Grants 5% more XP.",
        stats: { HP: 45, DMG: 12, DEF: 18, SPD: 16, CRIT: 3 },
        bonus: { type: "experienceMultiplier", multiplier: 1.05 },
        rarity: Rarity.Common,
        chanceWeight: 100_000_000,
    },
    coinling: {
        name: "Coinling",
        description: "A shiny little scavenger that collects loose change. Grants 5% more money.",
        stats: { HP: 38, DMG: 14, DEF: 12, SPD: 22, CRIT: 5 },
        bonus: { type: "balanceMultiplier", multiplier: 1.05 },
        rarity: Rarity.Common,
        chanceWeight: 85_000_000,
    },
    sparkit: {
        name: "Sparkit",
        description: "A restless ember with a knack for inspiring its trainer. Adds 4 XP to rewards.",
        stats: { HP: 42, DMG: 24, DEF: 10, SPD: 28, CRIT: 7 },
        bonus: { type: "experienceFlat", amount: 4 },
        rarity: Rarity.Uncommon,
        chanceWeight: 48_000_000,
    },
    burrowbuck: {
        name: "Burrowbuck",
        description: "A treasure-sniffing burrower that shares its finds. Adds $12 to money rewards.",
        stats: { HP: 55, DMG: 19, DEF: 23, SPD: 20, CRIT: 4 },
        bonus: { type: "balanceFlat", amount: 12 },
        rarity: Rarity.Uncommon,
        chanceWeight: 40_000_000,
    },
    glimmerfox: {
        name: "Glimmerfox",
        description: "Its glowing tracks lead to unusual creatures. Multiplies Rare-or-higher encounter weights by 1.25.",
        stats: { HP: 57, DMG: 28, DEF: 20, SPD: 38, CRIT: 10 },
        bonus: { type: "rareEncounterWeightMultiplier", multiplier: 1.25 },
        rarity: Rarity.Rare,
        chanceWeight: 20_000_000,
    },
    runowl: {
        name: "Runowl",
        description: "A patient keeper of forgotten lessons. Grants one extra skill point per level.",
        stats: { HP: 65, DMG: 30, DEF: 27, SPD: 29, CRIT: 8 },
        bonus: { type: "skillPointsFlat", amount: 1 },
        rarity: Rarity.Epic,
        chanceWeight: 8_000_000,
    },
    solmane: {
        name: "Solmane",
        description: "A radiant guardian whose warmth accelerates training. Grants 15% more XP.",
        stats: { HP: 90, DMG: 48, DEF: 42, SPD: 45, CRIT: 12 },
        bonus: { type: "experienceMultiplier", multiplier: 1.15 },
        rarity: Rarity.Legendary,
        chanceWeight: 3_000_000,
    },
    prismoth: {
        name: "Prismoth",
        description: "A wandering moth that reveals hidden trails. Multiplies Rare-or-higher encounter weights by 1.5.",
        stats: { HP: 80, DMG: 45, DEF: 35, SPD: 60, CRIT: 16 },
        bonus: { type: "rareEncounterWeightMultiplier", multiplier: 1.5 },
        rarity: Rarity.Mythic,
        chanceWeight: 1_000_000,
    },
    auroragon: {
        name: "Auroragon",
        description: "An ancient sky dragon whose presence attracts fortune. Grants 25% more money.",
        stats: { HP: 120, DMG: 70, DEF: 60, SPD: 55, CRIT: 18 },
        bonus: { type: "balanceMultiplier", multiplier: 1.25 },
        rarity: Rarity.Eternal,
        chanceWeight: 1,
    },
    pebblepup: {
        name: "Pebblepup",
        description: "A playful stone pup that finds spare coins. Adds $5 to money rewards.",
        stats: { HP: 52, DMG: 15, DEF: 25, SPD: 14, CRIT: 3 },
        bonus: { type: "balanceFlat", amount: 5 },
        rarity: Rarity.Common,
        chanceWeight: 75_000_000,
    },
    dewkip: {
        name: "Dewkip",
        description: "A small pond wanderer that keeps its trainer focused. Grants 3% more XP.",
        stats: { HP: 48, DMG: 13, DEF: 16, SPD: 23, CRIT: 4 },
        bonus: { type: "experienceMultiplier", multiplier: 1.03 },
        rarity: Rarity.Common,
        chanceWeight: 70_000_000,
    },
    bramblet: {
        name: "Bramblet",
        description: "A thorny companion with a knack for finding treats. Grants 8% more money.",
        stats: { HP: 54, DMG: 23, DEF: 28, SPD: 17, CRIT: 6 },
        bonus: { type: "balanceMultiplier", multiplier: 1.08 },
        rarity: Rarity.Uncommon,
        chanceWeight: 35_000_000,
    },
    starglider: {
        name: "Starglider",
        description: "A night glider that charts hidden trails. Multiplies Rare-or-higher encounter weights by 1.15.",
        stats: { HP: 60, DMG: 26, DEF: 22, SPD: 40, CRIT: 9 },
        bonus: { type: "rareEncounterWeightMultiplier", multiplier: 1.15 },
        rarity: Rarity.Rare,
        chanceWeight: 16_000_000,
    },
    frostlynx: {
        name: "Frostlynx",
        description: "A quiet hunter whose icy focus sharpens practice. Grants 10% more XP.",
        stats: { HP: 70, DMG: 38, DEF: 30, SPD: 42, CRIT: 11 },
        bonus: { type: "experienceMultiplier", multiplier: 1.10 },
        rarity: Rarity.Epic,
        chanceWeight: 6_000_000,
    },
    gildrake: {
        name: "Gildrake",
        description: "A small dragon that carries a surprising hoard. Adds $40 to money rewards.",
        stats: { HP: 92, DMG: 52, DEF: 45, SPD: 36, CRIT: 11 },
        bonus: { type: "balanceFlat", amount: 40 },
        rarity: Rarity.Legendary,
        chanceWeight: 2_000_000,
    },
    dreamwhale: {
        name: "Dreamwhale",
        description: "A gentle sky swimmer that remembers every lesson. Adds 20 XP to rewards.",
        stats: { HP: 110, DMG: 40, DEF: 58, SPD: 28, CRIT: 7 },
        bonus: { type: "experienceFlat", amount: 20 },
        rarity: Rarity.Mythic,
        chanceWeight: 500_000,
    },
    chronowing: {
        name: "Chronowing",
        description: "An ancient traveler that guides its trainer along hidden paths. Grants one extra skill point per level.",
        stats: { HP: 105, DMG: 60, DEF: 48, SPD: 70, CRIT: 17 },
        bonus: { type: "skillPointsFlat", amount: 1 },
        rarity: Rarity.Eternal,
        chanceWeight: 10,
    },
};

for (const [key, companion] of Object.entries(createAdditionalCompanions())) {
    if (Object.hasOwn(catalog, key)) throw new Error(`Duplicate companion key: ${key}`);
    catalog[key] = companion;
}

export const companions: Readonly<Record<string, Companion>> = catalog;

export function getCompanion(key: string): Companion | undefined {
    return Object.hasOwn(companions, key) ? companions[key] : undefined;
}

export type CompanionReward = "experience" | "balance" | "casino" | "skillPoints";

export function applyCompanionBonus(amount: number, reward: CompanionReward, active?: Companion): number {
    const bonus = active?.bonus;
    if (!bonus) return amount;
    switch (bonus.type) {
        case "experienceMultiplier":
            return reward === "experience" ? amount * bonus.multiplier : amount;
        case "balanceMultiplier":
            return reward === "balance" ? amount * bonus.multiplier : amount;
        case "casinoPayoutMultiplier":
            return reward === "casino" ? amount * bonus.multiplier : amount;
        case "experienceFlat":
            return reward === "experience" ? amount + bonus.amount : amount;
        case "balanceFlat":
            return reward === "balance" ? amount + bonus.amount : amount;
        case "skillPointsFlat":
            return reward === "skillPoints" ? amount + bonus.amount : amount;
        case "rareEncounterWeightMultiplier":
            return amount;
    }
}

export function applyCompanionBonuses(amount: number, reward: CompanionReward, active: readonly Companion[]): number {
    const flat = active.filter(companion => !("multiplier" in companion.bonus));
    const multipliers = active.filter(companion => "multiplier" in companion.bonus);
    return [...flat, ...multipliers].reduce((value, companion) => applyCompanionBonus(value, reward, companion), amount);
}

export const rarityWeightMultipliers: Readonly<Record<Rarity, number>> = {
    [Rarity.Common]: 5,
    [Rarity.Uncommon]: 3,
    [Rarity.Rare]: 1.5,
    [Rarity.Epic]: 1,
    [Rarity.Legendary]: 0.6,
    [Rarity.Mythic]: 0.35,
    [Rarity.Eternal]: 0.2,
};

export function companionEncounterWeight(candidate: Companion, active?: Companion): number {
    const boostedRarities: readonly Rarity[] = [Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic, Rarity.Eternal];
    const rarityWeight = candidate.chanceWeight * rarityWeightMultipliers[candidate.rarity];
    return active?.bonus.type === "rareEncounterWeightMultiplier" && boostedRarities.includes(candidate.rarity)
        ? rarityWeight * active.bonus.multiplier
        : rarityWeight;
}

export function companionSelectionWeights(
    circulation: readonly { key: string; quantity: string }[],
    active?: Companion | readonly Companion[],
    rareMultiplier = 1,
): { key: string; weight: number }[] {
    const counts = new Map(circulation.map(({ key, quantity }) => [key, Number(quantity)]));
    const activeCompanions: readonly Companion[] = active === undefined ? [] : "bonus" in active ? [active] : active;
    return Object.entries(companions).map(([key, companion]) => ({
        key,
        weight: activeCompanions.reduce((weight, equipped) =>
            weight * (equipped.bonus.type === "rareEncounterWeightMultiplier"
                && ![Rarity.Common, Rarity.Uncommon].includes(companion.rarity) ? equipped.bonus.multiplier : 1),
        companionEncounterWeight(companion))
            * ([Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic, Rarity.Eternal].includes(companion.rarity) ? rareMultiplier : 1)
            / (1 + (counts.get(key) ?? 0) / 100),
    }));
}
