import { afterEach, describe, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({ connect: vi.fn(), del: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ connect: db.connect }),
    getCache: () => ({ del: db.del }),
}));

import { scavengeForPlayer } from "../src/itemStorage.js";
import { defaultPlayerData } from "../src/classes/Player.js";

afterEach(() => vi.resetAllMocks());

function mockClient(cooldown: Date | null = null, failSave = false, used = 0, extra = false) {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("SELECT id FROM players")) return { rowCount: 1, rows: [{ id: "1" }] };
        if (sql.includes("SELECT p.data")) return {
            rows: [{ data: { ...defaultPlayerData, name: "Test", experience: 80 }, companions: [] }],
        };
        if (sql.includes("SELECT equipped_tools, next_scavenge_at")) return {
            rows: [{ equipped_tools: [], next_scavenge_at: cooldown, backpack_key: "small_pouch" }],
        };
        if (sql.includes("AS used")) return { rows: [{ used: String(used) }] };
        if (sql.includes("SELECT bonus_type")) return { rows: extra ? [{ bonus_type: "extraFindChance", multiplier: 0.5 }] : [] };
        if (sql.includes("SUM(quantity)")) return { rows: [] };
        if (sql.includes("INSERT INTO players")) {
            if (failSave) throw new Error("save failed");
            return { rows: [{ data: JSON.parse(String(values?.[1])) }] };
        }
        return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    db.connect.mockResolvedValue(client);
    db.del.mockResolvedValue(1);
    return client;
}

describe("scavenge transaction", () => {
    test("saves XP, inventory and cooldown together before reporting the result", async () => {
        const client = mockClient();
        const result = await scavengeForPlayer("1", () => 0);
        expect(result.status).toBe("found");
        if (result.status !== "found") throw new Error("Expected item");
        expect(result.key).toBe("wild_berries");
        expect(result.experienceAwarded).toBeGreaterThan(0);
        expect(result.progression.didLevelUp).toBe(true);
        const sql = client.query.mock.calls.map(call => call[0]);
        expect(sql.some(statement => statement.includes("INSERT INTO player_items"))).toBe(true);
        expect(sql.some(statement => statement.includes("INSERT INTO players"))).toBe(true);
        expect(sql.some(statement => statement.includes("UPDATE player_scavenge_state SET next_scavenge_at"))).toBe(true);
        expect(sql.at(-1)).toBe("COMMIT");
        expect(db.del).toHaveBeenCalledWith("player:1");
    });

    test("rolls back the inventory and cooldown when saving XP fails", async () => {
        const client = mockClient(null, true);
        await expect(scavengeForPlayer("1", () => 0)).rejects.toThrow("save failed");
        expect(client.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
        expect(db.del).not.toHaveBeenCalled();
        expect(client.release).toHaveBeenCalledOnce();
    });

    test("does not grant XP or items on cooldown", async () => {
        const client = mockClient(new Date(Date.now() + 60_000));
        const result = await scavengeForPlayer("1", () => 0);
        expect(result.status).toBe("cooldown");
        expect(client.query.mock.calls.some(call => call[0].includes("INSERT INTO player_items"))).toBe(false);
        expect(client.query.mock.calls.some(call => call[0].includes("INSERT INTO players"))).toBe(false);
    });

    test.each([10, 15])("blocks a full or overfull backpack (%i) without spending cooldown", async used => {
        const client = mockClient(null, false, used);
        expect(await scavengeForPlayer("1", () => 0)).toEqual({ status: "full", used, capacity: 10 });
        const statements = client.query.mock.calls.map(call => call[0]);
        expect(statements.some(sql => sql.includes("INSERT INTO player_items"))).toBe(false);
        expect(statements.some(sql => sql.includes("INSERT INTO players"))).toBe(false);
        expect(statements.some(sql => sql.includes("SET next_scavenge_at"))).toBe(false);
    });

    test("limits extra finds to available space", async () => {
        const client = mockClient(null, false, 9, true);
        const result = await scavengeForPlayer("1", () => 0);
        expect(result).toMatchObject({ status: "found", quantity: 1 });
        expect(client.query.mock.calls.find(call => call[0].includes("INSERT INTO player_items"))?.[1]).toEqual(["1", "wild_berries", 1]);
    });

    test("awards an extra find when there is room", async () => {
        mockClient(null, false, 8, true);
        expect(await scavengeForPlayer("1", () => 0)).toMatchObject({ status: "found", quantity: 2 });
    });
});
