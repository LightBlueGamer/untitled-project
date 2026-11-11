import { companions } from "./companions.js";
import { items, ItemCategory } from "./items.js";
import { Rarity } from "./rarities.js";

export const lootboxRarities = Object.values(Rarity);
export type LootboxBoostType = "lootboxDrop" | "lootboxRarity" | "lootboxReward" | "lootboxFind";
export type LootboxReward =
    | { type: "item"; key: string }
    | { type: "companion"; key: string }
    | { type: "boost"; bonus: LootboxBoostType; multiplier: number; durationMinutes: number };

export function lootboxDropChance(multiplier: number): number {
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Invalid lootbox drop multiplier");
    return Math.min(1, multiplier / 500);
}

function choose<T>(entries: readonly T[], weights: readonly number[], random: () => number): T {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!entries.length || entries.length !== weights.length || !Number.isFinite(total) || total <= 0) {
        throw new Error("Invalid lootbox weight distribution");
    }
    let roll = random() * total;
    for (let index = 0; index < entries.length; index++) {
        roll -= weights[index];
        if (roll < 0) return entries[index];
    }
    return entries[entries.length - 1];
}

export function lootboxRarityWeights(source: "message" | "prestige", prestige: number, bonus: number): number[] {
    const base = source === "message" ? [5000, 2000, 800, 250, 70, 15, 2] : [0, 0, 500, 200, 80, 25, 5];
    const prestigeFactor = source === "prestige" ? 1 + Math.max(prestige - 1, 0) * 0.05 : 1;
    const factor = Math.max(1, bonus * prestigeFactor);
    if (!Number.isFinite(factor)) throw new Error("Invalid lootbox rarity multiplier");
    return base.map((weight, index) => weight * factor ** (index - 6));
}

export function rollLootboxRarity(
    source: "message" | "prestige", prestige: number, bonus: number, random: () => number = Math.random,
): Rarity {
    return choose(lootboxRarities, lootboxRarityWeights(source, prestige, bonus), random);
}

export function lootboxRewardRarityWeights(box: Rarity, bonus: number): number[] {
    const base = [100, 45, 20, 9, 4, 2, 1];
    const factor = Math.max(1, bonus);
    if (!Number.isFinite(factor)) throw new Error("Invalid lootbox reward multiplier");
    return base.map((weight, index) => weight * (lootboxRarities[index] === box ? 20 : 1) * factor ** (index - 6));
}

export function rollLootboxReward(box: Rarity, bonus: number, findBonus: number, random: () => number = Math.random): LootboxReward {
    const kind = choose(["item", "companion", "boost"] as const, [45 * findBonus, 45 * findBonus, 10], random);
    if (kind === "boost") {
        const type = choose(["lootboxDrop", "lootboxRarity", "lootboxReward", "lootboxFind"] as const, [1, 1, 1, 1], random);
        const durationMinutes = choose([15, 30, 60], [1, 1, 1], random);
        return { type: "boost", bonus: type, multiplier: 1.1 + lootboxRarities.indexOf(box) * 0.05, durationMinutes };
    }
    const catalog = kind === "item"
        ? Object.entries(items).filter(([, item]) => item.category !== ItemCategory.Backpack)
        : Object.entries(companions);
    const weights = lootboxRewardRarityWeights(box, bonus).map((weight, index) =>
        catalog.some(([, entry]) => entry.rarity === lootboxRarities[index]) ? weight : 0);
    const rarity = choose(lootboxRarities, weights, random);
    const eligible = catalog.filter(([, entry]) => entry.rarity === rarity);
    const key = choose(eligible, eligible.map(([, entry]) => "chanceWeight" in entry ? entry.chanceWeight : 1), random)[0];
    return { type: kind, key };
}

export function describeLootboxBoost(type: LootboxBoostType): string {
    if (type === "lootboxDrop") return "message lootbox chance";
    if (type === "lootboxRarity") return "higher-rarity lootbox odds";
    if (type === "lootboxFind") return "item and companion lootbox reward odds";
    return "higher-rarity lootbox reward odds";
}
