import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import pg from "pg";
import type { Client } from "discord.js";

const mocks = vi.hoisted(() => ({ pool: null as pg.Pool | null }));
vi.mock("../src/database.js", () => ({
    getPool: () => {
        if (!mocks.pool) throw new Error("Test database is not initialized");
        return mocks.pool;
    },
    getCache: () => ({ del: async () => 1, set: async () => "OK" }),
}));

import {
    getCompanionCirculation,
    getCompanionChannelState,
    equipCompanion,
    unequipCompanion,
    catchCompanionEncounter,
    createCompanionEncounter,
    expireCompanionEncounter,
    getOpenCompanionEncounters,
    setEncounterMessage,
    getPlayerCompanions,
    initializeCompanionStorage,
    loseCompanion,
    obtainCompanion,
    saveCompanionChannelState,
} from "../src/companionStorage.js";
import Player, { PlayerConflictError } from "../src/classes/Player.js";
import { getPrestigeBuff } from "../src/resources/functions.js";

const databaseUrl = process.env.TEST_POSTGRES_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("companion storage with PostgreSQL", () => {
    const schema = `test_companions_${process.pid}_${Date.now()}`;
    let admin: pg.Pool;

    beforeAll(async () => {
        admin = new pg.Pool({ connectionString: databaseUrl });
        await admin.query(`CREATE SCHEMA ${schema}`);
        mocks.pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
        await mocks.pool.query("CREATE TABLE players (id TEXT PRIMARY KEY, data JSONB NOT NULL)");
        await initializeCompanionStorage();
        await initializeCompanionStorage();
        await mocks.pool.query(`INSERT INTO players (id, data) VALUES ('player-a', '{}'), ('player-b', '{}')`);
    });

    afterAll(async () => {
        await mocks.pool?.end();
        if (admin) {
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            await admin.end();
        }
    });

    test("concurrent obtains and losses maintain inventory and circulation", async () => {
        await Promise.all(Array.from({ length: 20 }, () => obtainCompanion("player-a", "mossprout")));
        await obtainCompanion("player-b", "mossprout");
        expect(await getPlayerCompanions("player-a")).toEqual([{ key: "mossprout", quantity: 20 }]);
        expect(await getCompanionCirculation()).toEqual([{ key: "mossprout", quantity: "21" }]);
        await Promise.all(Array.from({ length: 10 }, () => loseCompanion("player-a", "mossprout")));
        const remaining = await Promise.allSettled(
            Array.from({ length: 15 }, () => loseCompanion("player-a", "mossprout")),
        );
        expect(remaining.filter(result => result.status === "fulfilled")).toHaveLength(10);
        expect(remaining.filter(result => result.status === "rejected")).toHaveLength(5);
        expect(await getPlayerCompanions("player-a")).toEqual([]);
        expect(await getPlayerCompanions("player-b")).toEqual([{ key: "mossprout", quantity: 1 }]);
        expect(await getCompanionCirculation()).toEqual([{ key: "mossprout", quantity: "1" }]);
        const events = await mocks.pool!.query<{ total: string; count: string }>(
            "SELECT sum(quantity_change)::text AS total, count(*)::text AS count FROM companion_events",
        );
        expect(events.rows[0]).toEqual({ total: "1", count: "41" });
    });

    test("persists channel appearance chance and last sender", async () => {
        await saveCompanionChannelState("channel-persistent", { chance: 73, lastUserId: "last-sender" });
        expect(await getCompanionChannelState("channel-persistent")).toEqual({
            chance: 73,
            lastUserId: "last-sender",
        });
        await saveCompanionChannelState("channel-persistent", { chance: 80, lastUserId: "next-sender" });
        expect(await getCompanionChannelState("channel-persistent")).toEqual({
            chance: 80,
            lastUserId: "next-sender",
        });
    });

    test("rollbacks, invalid keys and absent players never leave events", async () => {
        const client = await mocks.pool!.connect();
        try {
            await client.query("BEGIN");
            await client.query(
                "INSERT INTO player_companions VALUES ($1, $2, 1)",
                ["player-a", "coinling"],
            );
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
        await expect(obtainCompanion("missing", "coinling")).rejects.toThrow();
        await expect(obtainCompanion("player-a", "not-a-companion")).rejects.toThrow("Unknown companion");
        await expect(loseCompanion("player-a", "coinling")).rejects.toThrow("does not own");
        expect(await getPlayerCompanions("player-a")).toEqual([]);
        expect(await getCompanionCirculation()).toEqual([{ key: "mossprout", quantity: "1" }]);
    });

    test("ordinary player saves do not replace companion inventory", async () => {
        await mocks.pool!.query(`UPDATE players SET data = '{"level": 2}' WHERE id = 'player-b'`);
        expect(await getPlayerCompanions("player-b")).toEqual([{ key: "mossprout", quantity: 1 }]);
        expect(await loseCompanion("player-b", "mossprout")).toBe(0);
        expect(await getCompanionCirculation()).toEqual([{ key: "mossprout", quantity: "0" }]);
    });

    test("prestige buffs and pending choices survive PostgreSQL reloads", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES ('prestige-test', '{"name":"Test","level":10,"skillPoints":9}')`);
        const player = await Player.findById("prestige-test");
        if (!player) throw new Error("Missing test player");
        const choices = [getPrestigeBuff("17"), getPrestigeBuff("23"), getPrestigeBuff("27")];
        await player.addTemporaryPrestigeBuffData(choices).save();
        const loaded = await Player.findById("prestige-test");
        if (!loaded) throw new Error("Missing reloaded player");
        expect(loaded.temporaryPrestigeBuffData?.map(choice => choice.id)).toEqual([17, 23, 27]);
        loaded.prestige().clearTemporaryPrestigeBuffData();
        getPrestigeBuff("17").buff(loaded);
        getPrestigeBuff("23").buff(loaded);
        getPrestigeBuff("27").buff(loaded);
        await loaded.save();
        const after = await Player.findById("prestige-test");
        if (!after) throw new Error("Missing prestiged player");
        expect(after.prestigeLevel).toBe(1);
        expect(after.skillPoints).toBe(3);
        expect(after.prestigeExperienceFlat).toBe(3);
        expect(after.prestigeCompanionSpawnMultiplier).toBeCloseTo(1.05);
        expect(after.temporaryPrestigeBuffData).toEqual([]);
    });

    test("player instances expose durable inventory without stale saves overwriting it", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES ('player-c', '{"name":"Test","level":10}')`);
        const stale = await Player.findById("player-c");
        const player = await Player.findById("player-c");
        if (!stale || !player) throw new Error("Missing test player");
        expect(player.companions).toEqual([]);
        expect(await player.obtainCompanion("mossprout")).toBe(1);
        expect(await player.obtainCompanion("mossprout")).toBe(2);
        expect(await player.obtainCompanion("coinling")).toBe(1);
        expect(player.toJSON().companions).toEqual([
            { key: "coinling", quantity: 1 }, { key: "mossprout", quantity: 2 },
        ]);
        const snapshot = player.companions;
        Object.assign(snapshot[0], { quantity: 999 });
        expect(player.companions[0].quantity).toBe(1);
        stale.addBalance(10);
        await stale.save();
        const loaded = await Player.findById("player-c");
        if (!loaded) throw new Error("Missing test player");
        expect(loaded.companions).toEqual(player.companions);
        expect((await Player.findAll()).find(item => item.id === "player-c")?.companions).toEqual(player.companions);
        loaded.prestige();
        await loaded.save();
        expect((await Player.findById("player-c"))?.companions).toEqual(player.companions);
        expect(await player.loseCompanion("coinling")).toBe(0);
        expect(player.companions).toEqual([{ key: "mossprout", quantity: 2 }]);
        await expect(player.loseCompanion("coinling")).rejects.toThrow("does not own");
        expect(player.companions).toEqual([{ key: "mossprout", quantity: 2 }]);
        await Promise.all(Array.from({ length: 10 }, () => player.obtainCompanion("mossprout")));
        expect(player.companions).toEqual([{ key: "mossprout", quantity: 12 }]);
        expect((await Player.findById("player-c"))?.companions).toEqual(player.companions);
        const row = await mocks.pool!.query<{ data: Record<string, unknown> }>(
            "SELECT data FROM players WHERE id = 'player-c'",
        );
        expect(row.rows[0].data).not.toHaveProperty("companions");
    });

    test("player creation and concurrent-insert fallback hydrate inventory", async () => {
        const discord = { users: { fetch: async () => ({ username: "Test" }) } } as Client;
        const created = await Player.get("player-new", discord);
        expect(created.companions).toEqual([]);
        await obtainCompanion("player-new", "coinling");
        const lookup = vi.spyOn(Player, "findById").mockResolvedValueOnce(null);
        try {
            const existing = await Player.get("player-new", discord);
            expect(existing.companions).toEqual([{ key: "coinling", quantity: 1 }]);
        } finally {
            lookup.mockRestore();
        }
    });

    test("equipment requires ownership, survives stale saves and prestige, and clears on final loss", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES ('player-equip', '{"name":"Test","level":10}')`);
        const stale = await Player.findById("player-equip");
        if (!stale) throw new Error("Missing test player");
        expect(await equipCompanion("player-equip", "mossprout")).toBe("unowned");
        await obtainCompanion("player-equip", "mossprout");
        await obtainCompanion("player-equip", "mossprout");
        expect(await equipCompanion("player-equip", "mossprout")).toBe("equipped");
        stale.addBalance(1);
        await stale.save();
        expect(stale.equippedCompanion).toBe("mossprout");
        const active = await Player.findById("player-equip");
        if (!active) throw new Error("Missing test player");
        active.prestige();
        await active.save();
        expect((await Player.findById("player-equip"))?.equippedCompanion).toBe("mossprout");
        expect(await loseCompanion("player-equip", "mossprout")).toBe(1);
        expect((await Player.findById("player-equip"))?.equippedCompanion).toBe("mossprout");
        expect(await loseCompanion("player-equip", "mossprout")).toBe(0);
        expect((await Player.findById("player-equip"))?.equippedCompanion).toBeNull();
        const unowned = await Promise.all([equipCompanion("player-equip", "mossprout"), equipCompanion("player-equip", "coinling")]);
        expect(unowned).toEqual(["unowned", "unowned"]);
    });

    test("slots, concurrent equips, explicit unequip, and prestige capacity are enforced", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES
            ('player-slots', '{"name":"Test","level":10,"skills":["companion_bond"],"prestigeCompanionSlot":true}')`);
        for (const key of ["mossprout", "coinling", "sparkit", "runowl"]) await obtainCompanion("player-slots", key);
        expect(await equipCompanion("player-slots", "mossprout")).toBe("equipped");
        expect(await equipCompanion("player-slots", "mossprout")).toBe("already-equipped");
        const results = await Promise.all(["coinling", "sparkit", "runowl"].map(key => equipCompanion("player-slots", key)));
        expect(results.filter(result => result === "equipped")).toHaveLength(2);
        expect(results.filter(result => result === "full")).toHaveLength(1);
        const player = await Player.findById("player-slots");
        if (!player) throw new Error("Missing test player");
        expect(player.equippedCompanions).toHaveLength(3);
        const expected = player.equippedCompanions.slice(0, 2);
        player.prestige();
        await player.save();
        const after = await Player.findById("player-slots");
        if (!after) throw new Error("Missing prestiged player");
        expect(after.companionSlots).toBe(2);
        expect(after.equippedCompanions).toEqual(expected);
        expect(await unequipCompanion("player-slots", expected[1])).toBe("unequipped");
        expect(await unequipCompanion("player-slots", expected[1])).toBe("not-equipped");
        expect((await Player.findById("player-slots"))?.equippedCompanions).toEqual([expected[0]]);
    });

    test("losing an equipped species removes only that species and stale reward saves conflict", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES
            ('player-multi-loss', '{"name":"Test","prestigeCompanionSlot":true}')`);
        await obtainCompanion("player-multi-loss", "coinling");
        await obtainCompanion("player-multi-loss", "mossprout");
        await equipCompanion("player-multi-loss", "coinling");
        await equipCompanion("player-multi-loss", "mossprout");
        const stale = await Player.findById("player-multi-loss");
        if (!stale) throw new Error("Missing test player");
        stale.assignRandomExperienceAndBalance(() => 0);
        await loseCompanion("player-multi-loss", "coinling");
        await expect(stale.save()).rejects.toBeInstanceOf(PlayerConflictError);
        const current = await Player.findById("player-multi-loss");
        expect(current?.equippedCompanions).toEqual(["mossprout"]);
        expect(current?.equippedCompanion).toBe("mossprout");
    });

    test("reward saves reject stale equipment and retain skill point bonuses per level", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES ('player-reward', '{"name":"Test"}')`);
        await obtainCompanion("player-reward", "runowl");
        const stale = await Player.findById("player-reward");
        if (!stale) throw new Error("Missing test player");
        stale.assignRandomExperienceAndBalance(() => 0);
        await equipCompanion("player-reward", "runowl");
        await expect(stale.save()).rejects.toBeInstanceOf(PlayerConflictError);
        const current = await Player.findById("player-reward");
        if (!current) throw new Error("Missing test player");
        const result = current.addExperience(1000);
        expect(result.skillPointsGained).toBe(result.levelsGained * 2);
        await current.save();
        expect((await Player.findById("player-reward"))?.skillPoints).toBe(result.skillPointsGained);
    });

    test("concurrent equip and final loss never leave an unowned companion equipped", async () => {
        await mocks.pool!.query(`INSERT INTO players (id, data) VALUES ('player-race', '{"name":"Test"}')`);
        for (let i = 0; i < 10; i++) {
            await obtainCompanion("player-race", "coinling");
            await Promise.all([equipCompanion("player-race", "coinling"), loseCompanion("player-race", "coinling")]);
            const player = await Player.findById("player-race");
            expect(player?.companions).toEqual([]);
            expect(player?.equippedCompanion).toBeNull();
        }
    });

    test("only one catcher obtains an encounter, and its circulation is updated atomically", async () => {
        const id = "b9c9b0a7-2342-4c8f-a016-000000000001";
        await createCompanionEncounter(id, "channel", "mossprout");
        await setEncounterMessage(id, "message");
        expect((await getOpenCompanionEncounters()).some(encounter => encounter.id === id)).toBe(true);
        const attempts = await Promise.all(Array.from({ length: 10 }, (_, i) =>
            catchCompanionEncounter(id, "channel", "message", `catcher-${i}`, `Player ${i}`)));
        expect(attempts.filter(result => result === "mossprout")).toHaveLength(1);
        expect(attempts.filter(result => result === null)).toHaveLength(9);
        const inventory = await mocks.pool!.query<{ total: string }>(
            "SELECT sum(quantity)::text AS total FROM player_companions WHERE player_id LIKE 'catcher-%'",
        );
        expect(inventory.rows[0].total).toBe("1");
        const events = await mocks.pool!.query<{ total: string }>(
            "SELECT sum(quantity_change)::text AS total FROM companion_events WHERE player_id LIKE 'catcher-%'",
        );
        expect(events.rows[0].total).toBe("1");
        expect(await expireCompanionEncounter(id)).toBe(false);
    });

    test("expired or mismatched encounter messages cannot be caught", async () => {
        const id = "b9c9b0a7-2342-4c8f-a016-000000000002";
        await createCompanionEncounter(id, "channel", "coinling");
        await setEncounterMessage(id, "message");
        expect(await catchCompanionEncounter(id, "other", "message", "unlucky", "Test")).toBeNull();
        expect(await catchCompanionEncounter(id, "channel", "other", "unlucky", "Test")).toBeNull();
        await mocks.pool!.query("UPDATE companion_encounters SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1", [id]);
        expect(await catchCompanionEncounter(id, "channel", "message", "unlucky", "Test")).toBeNull();
        expect(await expireCompanionEncounter(id)).toBe(true);
        expect(await expireCompanionEncounter(id)).toBe(false);
        expect(await getPlayerCompanions("unlucky")).toEqual([]);
    });

    test("a failed award rolls back the claim and can be retried", async () => {
        const id = "b9c9b0a7-2342-4c8f-a016-000000000003";
        await createCompanionEncounter(id, "channel", "mossprout");
        await setEncounterMessage(id, "message");
        await mocks.pool!.query("ALTER TABLE players ADD CONSTRAINT test_reject_catcher CHECK (id <> 'blocked-catcher')");
        try {
            await expect(catchCompanionEncounter(id, "channel", "message", "blocked-catcher", "Blocked")).rejects.toThrow();
            expect(await catchCompanionEncounter(id, "channel", "message", "retry-catcher", "Retry")).toBe("mossprout");
            expect(await getPlayerCompanions("retry-catcher")).toEqual([{ key: "mossprout", quantity: 1 }]);
        } finally {
            await mocks.pool!.query("ALTER TABLE players DROP CONSTRAINT test_reject_catcher");
        }
    });

    test("new companions can be caught, equipped, and counted", async () => {
        const id = "b9c9b0a7-2342-4c8f-a016-000000000004";
        await createCompanionEncounter(id, "channel", "chronosage");
        await setEncounterMessage(id, "message");
        expect(await catchCompanionEncounter(id, "channel", "message", "new-companion-player", "Test")).toBe("chronosage");
        expect(await equipCompanion("new-companion-player", "chronosage")).toBe("equipped");
        expect(await getPlayerCompanions("new-companion-player")).toEqual([{ key: "chronosage", quantity: 1 }]);
        expect(await getCompanionCirculation()).toContainEqual({ key: "chronosage", quantity: "1" });
        const player = await Player.findById("new-companion-player");
        expect(player?.equippedCompanion).toBe("chronosage");
    });
});
