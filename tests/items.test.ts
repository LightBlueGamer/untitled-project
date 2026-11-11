import { describe, expect, test } from "vitest";
import {
    CraftableItem,
    BackpackUpgrade,
    backpacks,
    getScavengeWeight,
    Item,
    ItemCategory,
    items,
    Tool,
    tools
} from "../src/resources/items.js";
import { Rarity } from "../src/resources/rarities.js";

describe("item catalog", () => {
    test("includes categorized scavengable items across rarities with varied weights and prices", () => {
        const scavengable = Object.values(items).filter(item => item.canScavenge);
        expect(scavengable).toHaveLength(150);
        const expectedRarityCounts: Record<Rarity, number> = {
            [Rarity.Common]: 17,
            [Rarity.Uncommon]: 17,
            [Rarity.Rare]: 15,
            [Rarity.Epic]: 10,
            [Rarity.Legendary]: 8,
            [Rarity.Mythic]: 8,
            [Rarity.Eternal]: 5,
        };
        for (const [rarity, expectedCount] of Object.entries(expectedRarityCounts)) {
            expect(scavengable.filter(item => item.rarity === rarity)).toHaveLength(expectedCount + 10);
        }
        const categoryCounts: Record<ItemCategory, number> = {
            [ItemCategory.Material]: 36,
            [ItemCategory.Component]: 36,
            [ItemCategory.Consumable]: 38,
            [ItemCategory.Treasure]: 40,
            [ItemCategory.Tool]: 0,
            [ItemCategory.Backpack]: 0,
        };
        for (const [category, expectedCount] of Object.entries(categoryCounts)) {
            expect(scavengable.filter(item => item.category === category)).toHaveLength(expectedCount);
        }
        expect(new Set(scavengable.map(item => item.rarity))).toEqual(new Set(Object.values(Rarity)));
        expect(new Set(scavengable.map(item => item.category).filter(category => category !== ItemCategory.Tool)).size)
            .toBeGreaterThanOrEqual(4);
        expect(new Set(scavengable.map(item => item.weight)).size).toBeGreaterThan(5);
        expect(new Set(scavengable.map(item => item.price)).size).toBeGreaterThan(5);
        expect(scavengable.every(item => item.weight > 0 && item.price > 0)).toBe(true);
        const weightRanges: Record<Rarity, [number, number]> = {
            [Rarity.Common]: [85_000_000, 115_000_000],
            [Rarity.Uncommon]: [25_500_000, 34_500_000],
            [Rarity.Rare]: [7_650_000, 10_350_000],
            [Rarity.Epic]: [2_295_000, 3_105_000],
            [Rarity.Legendary]: [688_500, 931_500],
            [Rarity.Mythic]: [206_550, 279_450],
            [Rarity.Eternal]: [61_000, 84_000],
        };
        for (const [rarity, [minimum, maximum]] of Object.entries(weightRanges)) {
            const weights = scavengable.filter(item => item.rarity === rarity).map(item => item.weight);
            expect(Math.min(...weights)).toBeGreaterThanOrEqual(minimum);
            expect(Math.max(...weights)).toBeLessThanOrEqual(maximum);
        }
        expect(Object.values(tools)).toHaveLength(8);
        expect(getScavengeWeight(items.wild_berries)).toBe(items.wild_berries.weight);
    });

    test("backpack upgrades are sequential and fit in the preceding capacity", () => {
        const tiers = Object.values(backpacks);
        expect(tiers.map(tier => tier.capacity)).toEqual([10, 20, 35, 55, 80]);
        for (let index = 1; index < tiers.length; index++) {
            const upgrade = tiers[index];
            expect(upgrade).toBeInstanceOf(BackpackUpgrade);
            if (!(upgrade instanceof BackpackUpgrade)) throw new Error("Expected an upgrade");
            expect(upgrade.previous).toBe(tiers[index - 1]);
            expect(upgrade.recipe.get(upgrade.previous)).toBe(1);
            expect([...upgrade.recipe].reduce((sum, [ingredient, amount]) =>
                sum + (ingredient === upgrade.previous ? 0 : amount), 0)).toBeLessThanOrEqual(tiers[index - 1].capacity);
        }
    });

    test("craftable items and tools use valid ingredients and have prices from their recipes", () => {
        for (const [key, item] of Object.entries(items)) {
            if (!(item instanceof CraftableItem)) continue;
            expect(item.canScavenge).toBe(false);
            expect(item.recipe.size).toBeGreaterThan(0);
            const recipeValue = [...item.recipe].reduce((sum, [ingredient, amount]) => {
                expect(Object.values(items)).toContain(ingredient);
                expect(amount).toBeGreaterThan(0);
                return sum + ingredient.price * amount;
            }, 0);
            expect(item.price).toBe(Math.floor(recipeValue * 1.05), key);
        }

        expect(Object.values(tools).length).toBeGreaterThanOrEqual(8);
        expect(Object.values(tools).every(tool => tool instanceof Tool && tool.bonus.multiplier > 1)).toBe(true);
        for (const item of Object.values(items)) {
            expect(item.toolsWithBonus.every(tool => Object.values(tools).includes(tool))).toBe(true);
            expect(item.blacklistTools.every(tool => Object.values(tools).includes(tool))).toBe(true);
        }
    });

    test("every consumable has a timed scavenging effect", () => {
        const consumables = Object.values(items).filter(item => item.category === ItemCategory.Consumable);
        expect(consumables.length).toBeGreaterThan(0);
        expect(consumables.every(item => item.consumableBonus)).toBe(true);
        for (const item of consumables) {
            expect(["scavengeRarity", "extraFindChance"]).toContain(item.consumableBonus?.type);
            expect(item.consumableBonus?.multiplier).toBeGreaterThan(
                item.consumableBonus?.type === "extraFindChance" ? 0 : 1,
            );
            expect(item.consumableBonus?.durationMinutes).toBeGreaterThan(0);
        }
    });

    test("tool filters, item-specific bonuses and tool bonuses affect scavenging weights", () => {
        const ironOre: Item = items.iron_ore;
        const pick = tools.iron_pick;
        expect(ironOre.toolsWithBonus).toContain(pick);
        expect(getScavengeWeight(ironOre, pick)).toBeCloseTo(ironOre.weight * 1.5 * 1.8);

        const berries = items.wild_berries;
        expect(berries.blacklistTools).toContain(pick);
        expect(getScavengeWeight(berries, pick)).toBe(0);
        expect(getScavengeWeight(berries)).toBeGreaterThan(0);

        const treasure = items.echo_crystal;
        const compass = tools.prospector_compass;
        expect(treasure.toolsWithBonus).toContain(compass);
        expect(getScavengeWeight(treasure, compass)).toBeCloseTo(treasure.weight * 1.5 * 2.5);

        const sieve = tools.moonlit_sieve;
        const unrelatedRareItem = new Item(
            "Test Relic", "A test-only item.", 100, Rarity.Legendary, ItemCategory.Treasure, 100, true
        );
        expect(unrelatedRareItem.toolsWithBonus).not.toContain(sieve);
        expect(getScavengeWeight(unrelatedRareItem, sieve)).toBe(160);
    });
});
