import { describe, expect, test } from "vitest";
import Player from "../src/classes/Player.js";
import { PrestigeBuffs } from "../src/resources/prestigeBuffs.js";
import { Rarity } from "../src/resources/rarities.js";
import { lootboxDropChance, lootboxRarities, lootboxRarityWeights, lootboxRewardRarityWeights, rollLootboxReward } from "../src/resources/lootboxes.js";
import { items, ItemCategory } from "../src/resources/items.js";

describe("lootbox odds", () => {
    test("message box weights descend and prestige one is most likely Rare", () => {
        expect(lootboxDropChance(1)).toBe(1 / 500);
        expect(lootboxDropChance(1.25)).toBe(1.25 / 500);
        expect(lootboxDropChance(1000)).toBe(1);
        const message = lootboxRarityWeights("message", 0, 1);
        expect(message.every((weight, i) => i === 0 || weight < message[i - 1])).toBe(true);
        const first = lootboxRarityWeights("prestige", 1, 1);
        expect(first.indexOf(Math.max(...first))).toBe(lootboxRarities.indexOf(Rarity.Rare));
        const later = lootboxRarityWeights("prestige", 10, 1);
        const chance = (weights: number[]) => weights.slice(3).reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0);
        expect(chance(later)).toBeGreaterThan(chance(first));
        expect(chance(lootboxRarityWeights("prestige", 60, 1))).toBeGreaterThan(chance(lootboxRarityWeights("prestige", 51, 1)));
        expect(chance(lootboxRarityWeights("prestige", 1, 1.3))).toBeGreaterThan(chance(first));
    });

    test("crafted non-backpack items are attainable as lootbox rewards", () => {
        const key = "iron_pick";
        const item = items[key];
        expect(item.canScavenge).toBe(false);
        const weights = lootboxRewardRarityWeights(item.rarity, 1);
        const index = lootboxRarities.indexOf(item.rarity);
        const rarityRoll = (weights.slice(0, index).reduce((a, b) => a + b, 0) + weights[index] / 2)
            / weights.reduce((a, b) => a + b, 0);
        const eligible = Object.entries(items).filter(([, candidate]) =>
            candidate.category !== ItemCategory.Backpack && candidate.rarity === item.rarity);
        const itemRoll = (eligible.findIndex(([candidate]) => candidate === key) + 0.5) / eligible.length;
        const rolls = [0, rarityRoll, itemRoll];
        expect(rollLootboxReward(item.rarity, 1, 1, () => rolls.shift()!)).toEqual({ type: "item", key });
    });

    test("matching rarity receives a twentyfold weight boost and higher-tier bonuses shift odds", () => {
        const base = lootboxRewardRarityWeights(Rarity.Common, 1);
        const epic = lootboxRewardRarityWeights(Rarity.Epic, 1);
        expect(epic[3] / base[3]).toBe(20);
        expect(epic[2] / base[2]).toBe(1);
        const bonus = lootboxRewardRarityWeights(Rarity.Epic, 1.3);
        expect(bonus[6] / bonus[0]).toBeGreaterThan(epic[6] / epic[0]);
    });

    test("find bonuses increase combined item and companion chance against boosts", () => {
        expect(rollLootboxReward(Rarity.Rare, 1, 1, () => 0.91).type).toBe("boost");
        expect(rollLootboxReward(Rarity.Rare, 1, 2, () => 0.91).type).toBe("companion");
        expect(rollLootboxReward(Rarity.Rare, 1, 1, () => 0).type).toBe("item");
    });

    test("skills and permanent prestige buffs affect all four lootbox modifiers", () => {
        const player = new Player("Test", "1", { skills: ["box_hunter", "box_fortune", "box_treasures", "box_recovery"] });
        for (const id of [32, 33, 34, 35]) PrestigeBuffs.find(buff => buff.id === id)!.buff(player);
        expect(player.lootboxDropMultiplier).toBeCloseTo(1.25 * 1.15);
        expect(player.lootboxRarityMultiplier).toBeCloseTo(1.25 * 1.15);
        expect(player.lootboxRewardMultiplier).toBeCloseTo(1.3 * 1.2);
        expect(player.lootboxFindMultiplier).toBeCloseTo(1.3 * 1.2);
        player.prestige();
        expect(player.lootboxDropMultiplier).toBeCloseTo(1.15);
        expect(player.lootboxFindMultiplier).toBeCloseTo(1.2);
    });
});
