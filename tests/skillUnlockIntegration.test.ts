import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.SKILL_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("skill unlocks on PostgreSQL", () => {
    let db: typeof import("../src/database.js");
    let unlockSkill: typeof import("../src/skillStorage.js").unlockSkill;
    let Player: typeof import("../src/classes/Player.js").default;
    const id = `skill-test-${randomUUID()}`;
    beforeAll(async () => {
        process.env.POSTGRES_URL = databaseUrl;
        db = await import("../src/database.js");
        Player = (await import("../src/classes/Player.js")).default;
        unlockSkill = (await import("../src/skillStorage.js")).unlockSkill;
        await db.initDatabase();
        vi.spyOn(Player, "invalidate").mockResolvedValue();
        await db.pool.query("INSERT INTO players (id, data) VALUES ($1, $2::jsonb)", [
            id, JSON.stringify({ name: id, skills: [], skillPoints: 1, prestige: 0 }),
        ]);
    });
    afterAll(async () => {
        vi.restoreAllMocks();
        await db.pool.end();
    });

    test("atomic requests cannot spend the same point twice, including duplicate confirms", async () => {
        const results = await Promise.all([
            unlockSkill(id, "experience_gain_1", 0),
            unlockSkill(id, "experience_gain_1", 0),
            unlockSkill(id, "extra_income", 0),
        ]);
        expect(results.filter(result => result.status === "unlocked")).toHaveLength(1);
        const player = await Player.findById(id);
        expect(player?.skills).toHaveLength(1);
        expect(player?.skillPoints).toBe(0);
    });

    test("checks prerequisites and prestige against current database state", async () => {
        await db.pool.query("UPDATE players SET data = $2::jsonb WHERE id = $1", [
            id, JSON.stringify({ name: id, skills: [], skillPoints: 5, prestige: 1 }),
        ]);
        expect((await unlockSkill(id, "experience_gain_1", 0)).status).toBe("stale");
        expect((await unlockSkill(id, "experience_gain_2", 1)).status).toBe("prerequisites");
        expect((await unlockSkill(id, "experience_gain_1", 1)).status).toBe("unlocked");
        expect((await unlockSkill(id, "experience_gain_1", 1)).status).toBe("already-unlocked");
        expect((await unlockSkill(id, "experience_gain_2", 1)).status).toBe("unlocked");
        expect((await Player.findById(id))?.skillPoints).toBe(2);
    });
});
