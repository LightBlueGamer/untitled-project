import { describe, expect, test, vi } from "vitest";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
import { selectShopItems, shopAppearanceChance, shopPrice, shopQuantity } from "../src/botShop.js";
import { items } from "../src/resources/items.js";
import { Rarity } from "../src/resources/rarities.js";

describe("Bot Shop generation", () => {
    test("uses each rarity's starting stock and negative-stock hurdles", () => {
        expect(Object.values(Rarity).map(rarity => shopQuantity(rarity, () => 0))).toEqual([10, 7, 5, 2, 1, 0, 0]);
        expect(shopQuantity(Rarity.Mythic, () => 0.99)).toBeGreaterThan(0);
        expect(shopQuantity(Rarity.Eternal, () => 0.999)).toBeGreaterThan(0);
    });

    test("has a decreasing extra-stock tail, but can reach thousands", () => {
        expect(shopQuantity(Rarity.Common, () => 0.99999)).toBeGreaterThan(1000);
        const rarities = Object.values(Rarity);
        for (let i = 1; i < rarities.length; i++) {
            const previousExtras = shopQuantity(rarities[i - 1], () => 0.999) - [10, 7, 5, 2, 1, -1, -3][i - 1];
            const nextExtras = shopQuantity(rarities[i], () => 0.999) - [10, 7, 5, 2, 1, -1, -3][i];
            expect(nextExtras).toBeLessThanOrEqual(previousExtras);
        }
    });

    test("makes rare and heavily circulating items less likely", () => {
        const chances = Object.values(Rarity).map(rarity => shopAppearanceChance(rarity, 0));
        for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThan(chances[i - 1]);
        expect(shopAppearanceChance(Rarity.Common, 500)).toBeLessThan(shopAppearanceChance(Rarity.Common, 0));
    });

    test("always selects one item, with decreasing chances of additional items", () => {
        const candidates = Array.from({ length: 10 }, (_, index) => ({ item: items.wild_berries, count: index }));
        expect(selectShopItems(candidates, () => 0.99)).toHaveLength(1);
        expect(selectShopItems(candidates, () => 0)).toHaveLength(10);
        expect(new Set(selectShopItems(candidates, () => 0)).size).toBe(10);
        const samples = 10000;
        const counts = Array.from({ length: 10 }, () => 0);
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
        for (let i = 0; i < samples; i++) counts[selectShopItems(candidates, random).length - 1]++;
        const reached = counts.map((_, index) => counts.slice(index).reduce((a, b) => a + b, 0));
        expect(reached[0]).toBe(samples);
        const secondChance = reached[1] / reached[0];
        const sixthChance = reached[5] / reached[4];
        expect(secondChance).toBeGreaterThan(0.85);
        expect(secondChance).toBeLessThan(0.95);
        expect(sixthChance).toBeLessThan(secondChance);
    });

    test("weights the guaranteed item by rarity and circulation", () => {
        const common = { item: items.wild_berries, count: 0 };
        const plentiful = { item: items.wild_berries, count: 1000 };
        const rare = { item: items.amber_shard, count: 0 };
        const candidates = [common, plentiful, rare];
        const counts = [0, 0, 0];
        for (let i = 0; i < 10000; i++) {
            const selected = selectShopItems(candidates, () => (i + 0.5) / 10000)[0];
            counts[candidates.indexOf(selected)]++;
        }
        expect(counts[0]).toBeGreaterThan(counts[1]);
        expect(counts[0]).toBeGreaterThan(counts[2]);
    });
    test("rounds bounded prices and makes scarce items more expensive for the same roll", () => {
        const item = items.wild_berries;
        for (const roll of [0, 0.2, 0.5, 0.8, 0.999999]) {
            const scarce = shopPrice(item, 0, () => roll);
            const plentiful = shopPrice(item, 1_000_000, () => roll);
            expect(scarce).toBeGreaterThanOrEqual(plentiful);
            expect(scarce).toBeGreaterThanOrEqual(2.5 * item.price);
            expect(scarce).toBeLessThanOrEqual(100 * item.price);
            expect(Number.isInteger(scarce)).toBe(true);
        }
        expect(shopPrice(item, 100, () => 0)).toBe(100 * item.price);
        expect(shopPrice(item, 0, () => 0.999999)).toBe(Math.round(2.5 * item.price));
    });

    test("favors high prices and smaller extra quantities", () => {
        const samples = 10000;
        const rolls = Array.from({ length: samples }, (_, index) => (index + 0.5) / samples);
        const prices = rolls.map(roll => shopPrice(items.wild_berries, 0, () => roll));
        expect(prices.filter(price => price >= 360).length).toBeGreaterThan(prices.filter(price => price <= 50).length);
        const stock = rolls.map(roll => shopQuantity(Rarity.Common, () => roll) - 10);
        expect(stock.filter(extras => extras >= 10).length).toBeLessThan(stock.filter(extras => extras >= 1).length);
        expect(stock.filter(extras => extras >= 100).length).toBeLessThan(stock.filter(extras => extras >= 10).length);
    });
});
