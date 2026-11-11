import { afterAll, beforeAll, describe, expect, test } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { vi } from "vitest";

vi.mock("../src/database.js", () => ({
    getPool: () => ({
        query: vi.fn(async () => ({ rows: [{ item_key: "iron_ore", quantity: "17" }] })),
    }),
}));

import router from "../src/api/routes/items.js";
import { CraftableItem, ItemCategory, items, Tool } from "../src/resources/items.js";
import Player from "../src/classes/Player.js";
import { calculateScavengeWeights, scavengeOdds } from "../src/itemStorage.js";

let server: Server;
let url: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/items", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/items`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("item API", () => {
    test("serializes the public item catalog, categories, recipes and tool rules", async () => {
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const data = await response.json();
        expect(data.categories).toEqual(Object.values(ItemCategory));
        expect(data.items).toHaveLength(Object.keys(items).length);
        expect(data.items.find(item => item.key === "iron_ore").circulation).toBe("17");
        expect(data.items.find(item => item.key === "iron_pick").circulation).toBe("0");
        const candidates = Object.entries(items).filter(([, item]) => item.canScavenge)
            .map(([key, item]) => ({ key, item }));
        const weights = calculateScavengeWeights(candidates, new Map([["iron_ore", 17]]), [], new Player("Test", "1"), []);
        const ironIndex = candidates.findIndex(candidate => candidate.key === "iron_ore");
        expect(data.items.find(item => item.key === "iron_ore").odds).toBeCloseTo(scavengeOdds(weights)[ironIndex]!);
        expect(data.items.find(item => item.key === "iron_pick").odds).toBeNull();
        expect(data.items.find(item => item.key === "small_pouch")).toMatchObject({ source: "Starter", capacity: 10, recipe: [] });
        expect(data.items.find(item => item.key === "shoulder_bag")).toMatchObject({
            source: "Crafted", capacity: 20, recipe: expect.arrayContaining([{ key: "small_pouch", name: "Small Pouch", quantity: 1 }]),
        });
        expect(data.items.find(item => item.key === "iron_ore")).not.toHaveProperty("weight");
        expect(data.items.find(item => item.key === "healing_balm")).toMatchObject({
            name: "Healing Balm",
            category: ItemCategory.Consumable,
            canScavenge: false,
            recipe: [
                { key: "wild_berries", name: "Wild Berries", quantity: 3 },
                { key: "moonleaf", name: "Moonleaf", quantity: 1 },
            ],
        });
        expect(data.items.find(item => item.key === "healing_balm").description)
            .toContain("Bonus effect: Increases Rare-or-better item weights by 1.1× for 30 minutes.");
        expect(data.items.find(item => item.key === "trail_rations").description)
            .toContain("Adds a 5% chance to find an extra item");
        for (const item of data.items.filter(item => item.category === ItemCategory.Consumable)) {
            expect(item.description).toContain("Bonus effect:");
            expect(item.description).not.toMatch(/scavengeRarity|extraFindChance/);
        }
        expect(data.items.find(item => item.key === "iron_ore").toolsWithBonus).toContain("Iron Pick");
        expect(data.items.find(item => item.key === "wild_berries").blacklistTools).toContain("Iron Pick");
        const tool = data.items.find(item => item.key === "iron_pick");
        expect(items.iron_pick).toBeInstanceOf(Tool);
        expect(tool.toolBonus).toContain("Material");
        for (const entry of data.items) {
            for (const ingredient of entry.recipe) {
                expect(items[ingredient.key]?.name).toBe(ingredient.name);
            }
        }
    });

    test("returns an item detail or a clear not-found response", async () => {
        const response = await fetch(`${url}/iron_pick`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            name: "Iron Pick",
            category: ItemCategory.Tool,
            circulation: "0",
            toolBonus: expect.stringContaining("Material"),
            recipe: expect.arrayContaining([{ key: "iron_ore", name: "Iron Ore", quantity: expect.any(Number) }]),
        });
        const missing = await fetch(`${url}/missing`);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "Item not found" });
    });

    test("item details list every recipe using the item with its required quantity", async () => {
        for (const key of ["wild_berries", "small_pouch", "shoulder_bag"]) {
            const response = await fetch(`${url}/${key}`);
            const detail = await response.json();
            const expected = Object.entries(items).flatMap(([recipeKey, item]) => {
                if (!(item instanceof CraftableItem)) return [];
                const quantity = item.recipe.get(items[key]);
                return quantity === undefined ? [] : [{ key: recipeKey, name: item.name, quantity }];
            }).sort((a, b) => a.name.localeCompare(b.name));
            expect(expected.length).toBeGreaterThan(0);
            expect(detail.usedIn).toEqual(expected);
        }
        expect((await (await fetch(`${url}/small_pouch`)).json()).usedIn)
            .toContainEqual({ key: "shoulder_bag", name: "Shoulder Bag", quantity: 1 });
        const unusedKey = Object.keys(items).find(key => !Object.values(items)
            .some(item => item instanceof CraftableItem && item.recipe.has(items[key])));
        expect(unusedKey).toBeDefined();
        expect((await (await fetch(`${url}/${unusedKey}`)).json()).usedIn).toEqual([]);
    });
});
