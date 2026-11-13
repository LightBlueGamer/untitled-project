import { afterEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({ connect: vi.fn(), del: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ connect: db.connect }),
    getCache: () => ({ del: db.del }),
}));

import Player, { defaultPlayerData } from "../src/classes/Player.js";
import { openLootbox, savePlayerWithLootbox, useLootboxBoost } from "../src/lootboxStorage.js";
import { Rarity } from "../src/resources/rarities.js";
import type { LootboxReward } from "../src/resources/lootboxes.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function mockClient(options: { used?: number; reward?: LootboxReward; failInsert?: boolean } = {}) {
    let pending = options.reward ?? null;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("SELECT id FROM players")) return { rows: [{ id: "1" }], rowCount: 1 };
        if (sql.includes("SELECT p.data")) return { rows: [{ data: { ...defaultPlayerData, name: "Test" }, companions: [] }] };
        if (sql.includes("SELECT id::text, rarity")) return { rows: [{ id: "1", rarity: Rarity.Rare, pending_reward: pending }] };
        if (sql.includes("SELECT multiplier FROM")) return { rows: [] };
        if (sql.includes("AS backpack_key")) return { rows: [{ backpack_key: "small_pouch", used: String(options.used ?? 0) }] };
        if (sql.includes("SET pending_reward")) pending = JSON.parse(String(values?.[1]));
        if (sql.includes("INSERT INTO player_lootboxes") && options.failInsert) throw new Error("insert failed");
        if (sql.includes("DELETE FROM player_lootbox_boosts")) return {
            rows: [{ id: "1", bonus_type: "lootboxFind", multiplier: 1.2, duration_minutes: 30 }],
        };
        return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    db.connect.mockResolvedValue(client);
    db.del.mockResolvedValue(1);
    return client;
}

describe("lootbox storage", () => {
    test("a full backpack preserves the rolled reward and never rerolls it", async () => {
        const options = { used: 10 };
        const client = mockClient(options);
        const full = await openLootbox("1", "1", () => 0);
        expect(full).toMatchObject({ status: "full", rarity: Rarity.Rare, previouslyPending: false });
        const save = client.query.mock.calls.find(call => call[0].includes("SET pending_reward"));
        expect(JSON.parse(String(save?.[1]?.[1]))).toMatchObject({ type: "item" });
        expect(client.query.mock.calls.some(call => call[0].includes("DELETE FROM player_lootboxes"))).toBe(false);
        options.used = 9;
        const opened = await openLootbox("1", "1", () => { throw new Error("must not reroll"); });
        expect(opened).toEqual({ status: "opened", rarity: Rarity.Rare, previouslyPending: true, reward: JSON.parse(String(save?.[1]?.[1])) });
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    });

    test("an item reward is saved and the box consumed within the same transaction", async () => {
        const client = mockClient({ used: 9, reward: { type: "item", key: "wild_berries" } });
        expect(await openLootbox("1", "1")).toEqual({ status: "opened", rarity: Rarity.Rare, previouslyPending: true, reward: { type: "item", key: "wild_berries" } });
        expect(client.query.mock.calls.some(call => call[0].includes("INSERT INTO player_items"))).toBe(true);
        expect(client.query.mock.calls.some(call => call[0].includes("DELETE FROM player_lootboxes"))).toBe(true);
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    });

    test("companion and boost rewards do not depend on backpack capacity", async () => {
        const companion = mockClient({ used: 50, reward: { type: "companion", key: "mossprout" } });
        expect(await openLootbox("1", "1")).toMatchObject({ status: "opened" });
        expect(companion.query.mock.calls.some(call => call[0].includes("INSERT INTO player_companions"))).toBe(true);
        expect(db.del).toHaveBeenCalledWith("player:1");
        const boost = mockClient({ used: 50, reward: { type: "boost", bonus: "lootboxFind", multiplier: 1.2, durationMinutes: 30 } });
        expect(await openLootbox("1", "1")).toMatchObject({ status: "opened" });
        expect(boost.query.mock.calls.some(call => call[0].includes("INSERT INTO player_lootbox_boosts"))).toBe(true);
    });

    test("boost consumption and activation commit together", async () => {
        const client = mockClient();
        expect(await useLootboxBoost("1", "1")).toMatchObject({ bonus_type: "lootboxFind" });
        expect(client.query.mock.calls.some(call => call[0].includes("INSERT INTO player_item_bonuses"))).toBe(true);
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    });

    test("box-award insertion failures roll back progression", async () => {
        const client = mockClient({ failInsert: true });
        const player = new Player("Test", "1");
        vi.spyOn(player, "save").mockResolvedValue();
        await expect(savePlayerWithLootbox(player, Rarity.Rare)).rejects.toThrow("insert failed");
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
        expect(db.del).not.toHaveBeenCalled();
    });

    test("committed lootbox awards are not reported as failed on cache errors", async () => {
        const client = mockClient();
        db.del.mockRejectedValue(new Error("cache down"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const player = new Player("Test", "1");
        vi.spyOn(player, "save").mockResolvedValue();
        await expect(savePlayerWithLootbox(player, Rarity.Rare)).resolves.toBeUndefined();
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
        expect(console.error).toHaveBeenCalled();
    });
});
