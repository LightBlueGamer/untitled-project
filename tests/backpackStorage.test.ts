import { afterEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), del: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ connect: db.connect, query: db.query }),
    getCache: () => ({ del: db.del }),
}));

import { craftPlayerItem, getPlayerScavengeState, initializeItemStorage, sellPlayerItem } from "../src/itemStorage.js";
import { defaultPlayerData } from "../src/classes/Player.js";
import { items } from "../src/resources/items.js";

afterEach(() => vi.resetAllMocks());

function mockClient(options: {
    backpack?: string; inventory?: Record<string, number>; equipped?: boolean; failSave?: boolean;
} = {}) {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("SELECT id FROM players")) return { rowCount: 1, rows: [{ id: "1" }] };
        if (sql.includes("SELECT p.data")) return {
            rows: [{ data: { ...defaultPlayerData, name: "Test", balance: 100 }, companions: [] }],
        };
        if (sql.includes("SELECT backpack_key")) return { rows: [{ backpack_key: options.backpack ?? "small_pouch" }] };
        if (sql.includes("SELECT quantity FROM player_items")) {
            const quantity = options.inventory?.[String(values?.[1])] ?? 0;
            return { rows: quantity ? [{ quantity }] : [] };
        }
        if (sql.includes("INSERT INTO players")) {
            if (options.failSave) throw new Error("save failed");
            return { rows: [{ data: JSON.parse(String(values?.[1])) }] };
        }
        if (sql.includes("array_remove")) return { rowCount: options.equipped ? 1 : 0, rows: [] };
        return { rowCount: 1, rows: [] };
    });
    const client = { query, release: vi.fn() };
    db.connect.mockResolvedValue(client);
    db.del.mockResolvedValue(1);
    return client;
}

describe("backpack crafting", () => {
    test("defaults missing state to the starter pouch and migrates existing tables", async () => {
        db.query.mockResolvedValue({ rows: [] });
        expect(await getPlayerScavengeState("1")).toMatchObject({ backpackKey: "small_pouch" });
        const client = mockClient();
        await initializeItemStorage();
        const schema = client.query.mock.calls.find(call => call[0].includes("ALTER TABLE player_scavenge_state"))?.[0];
        expect(schema).toContain("ADD COLUMN IF NOT EXISTS backpack_key TEXT NOT NULL DEFAULT 'small_pouch'");
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    });

    test("replaces the equipped previous tier and consumes ingredients atomically", async () => {
        const client = mockClient({ inventory: { scrap_cloth: 3, leather_strip: 3, copper_wire: 2 } });
        expect(await craftPlayerItem("1", "shoulder_bag")).toEqual({ status: "crafted", item: items.shoulder_bag });
        expect(client.query).toHaveBeenCalledWith(
            "UPDATE player_scavenge_state SET backpack_key = $2 WHERE player_id = $1", ["1", "shoulder_bag"],
        );
        expect(client.query.mock.calls.some(call => call[0].includes("INSERT INTO player_items"))).toBe(false);
        expect(client.query.mock.calls.filter(call => call[0].includes("DELETE FROM player_items"))).toHaveLength(2);
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    });

    test("rejects skipped tiers and missing ingredients without consuming anything", async () => {
        const first = mockClient();
        expect(await craftPlayerItem("1", "travel_pack")).toMatchObject({ status: "missing", item: items.shoulder_bag });
        expect(first.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
        const second = mockClient({ inventory: { scrap_cloth: 3 } });
        expect(await craftPlayerItem("1", "shoulder_bag")).toMatchObject({ status: "missing", item: items.leather_strip });
        expect(second.query.mock.calls.some(call => call[0].includes("DELETE FROM player_items"))).toBe(false);
        expect(second.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    });
});

describe("selling items", () => {
    test("credits the listed price and removes a sold-out equipped tool", async () => {
        const client = mockClient({ inventory: { iron_pick: 1 }, equipped: true });
        const result = await sellPlayerItem("1", "iron_pick", 1);
        expect(result).toMatchObject({ status: "sold", proceeds: items.iron_pick.price, unequipped: true });
        const save = client.query.mock.calls.find(call => call[0].includes("INSERT INTO players"));
        expect(JSON.parse(String(save?.[1]?.[1])).balance).toBe(100 + items.iron_pick.price);
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
        expect(db.del).toHaveBeenCalledWith("player:1");
    });

    test("partial sales retain equipped tools", async () => {
        const client = mockClient({ inventory: { iron_pick: 2 }, equipped: true });
        expect(await sellPlayerItem("1", "iron_pick", 1)).toMatchObject({ status: "sold", unequipped: false });
        expect(client.query.mock.calls.some(call => call[0].includes("array_remove"))).toBe(false);
    });

    test("rejects invalid quantities, unsellable items, and insufficient stock", async () => {
        expect(await sellPlayerItem("1", "wild_berries", 0)).toEqual({ status: "invalid" });
        expect(await sellPlayerItem("1", "wild_berries", 1.5)).toEqual({ status: "invalid" });
        expect(await sellPlayerItem("1", "small_pouch", 1)).toEqual({ status: "invalid" });
        const client = mockClient({ inventory: { wild_berries: 2 } });
        expect(await sellPlayerItem("1", "wild_berries", 3)).toEqual({ status: "unowned", owned: 2 });
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    });

    test("rolls inventory back when saving the balance fails", async () => {
        const client = mockClient({ inventory: { wild_berries: 1 }, failSave: true });
        await expect(sellPlayerItem("1", "wild_berries", 1)).rejects.toThrow("save failed");
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
        expect(db.del).not.toHaveBeenCalled();
    });

    test("a cache error after commit does not turn a completed sale into a failure", async () => {
        const client = mockClient({ inventory: { wild_berries: 1 } });
        db.del.mockRejectedValue(new Error("cache unavailable"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(await sellPlayerItem("1", "wild_berries", 1)).toMatchObject({ status: "sold", proceeds: 4 });
            expect(client.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
            expect(log).toHaveBeenCalled();
        } finally {
            log.mockRestore();
        }
    });
});
