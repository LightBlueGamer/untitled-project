import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    session: null as { id: string } | null,
    player: null as { name?: string; skills: string[]; skillPoints: number } | null,
    invalidate: vi.fn(),
    query: vi.fn(),
    findById: vi.fn(),
}));

vi.mock("../src/auth.js", () => ({
    loadSession: async () => mocks.session,
}));
vi.mock("../src/classes/Player.js", () => ({
    default: {
        findById: mocks.findById,
        invalidate: mocks.invalidate,
    },
}));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
}));

import skillsRouter from "../src/api/routes/skills.js";
import { skills } from "../src/resources/skills.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/skills", skillsRouter);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    baseUrl = `http://127.0.0.1:${address.port}/api/skills`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
    mocks.session = { id: "player-1" };
    mocks.player = { skills: [], skillPoints: 3 };
    mocks.invalidate.mockReset();
    mocks.query.mockReset();
    mocks.findById.mockReset().mockImplementation(async () => mocks.player);
    mocks.query.mockImplementation(async (_sql, [id, key, cost, prerequisites]) => {
        const player = mocks.player;
        if (id !== "player-1" || !player || player.skills.includes(key) ||
            prerequisites.some((prerequisite: string) => !player.skills.includes(prerequisite)) || player.skillPoints < cost) {
            return { rows: [] };
        }
        player.skills.push(key);
        player.skillPoints -= cost;
        return { rows: [{ data: { skills: [...player.skills], skillPoints: player.skillPoints } }] };
    });
});

const buy = (key: string) => fetch(`${baseUrl}/${key}`, { method: "POST" });

describe("skill tree API", () => {
    test("public player trees expose the selected player's skills without enabling purchases", async () => {
        mocks.session = null;
        mocks.player = { name: "Other", skills: ["extra_income"], skillPoints: 7 };
        const response = await fetch(`${baseUrl}/player/other`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({ name: "Other", unlocked: ["extra_income"], skillPoints: 7 });
        expect(mocks.findById).toHaveBeenCalledWith("other");
        expect((await fetch(`${baseUrl}/player/other`, { method: "POST" })).status).toBe(401);
        expect((await buy("experience_gain_1")).status).toBe(401);
        expect(mocks.query).not.toHaveBeenCalled();
        mocks.player = null;
        expect((await fetch(`${baseUrl}/player/missing`)).status).toBe(404);
    });

    test("purchase requests cannot choose another player", async () => {
        const response = await fetch(`${baseUrl}/extra_income?player=other`, { method: "POST" });
        expect(response.status).toBe(200);
        expect(mocks.query.mock.calls[0][1][0]).toBe("player-1");
        expect((await fetch(`${baseUrl}/player/other`, { method: "POST" })).status).toBe(404);
    });
    test("requires a login for both reading and purchasing", async () => {
        mocks.session = null;
        expect((await fetch(baseUrl)).status).toBe(401);
        expect((await buy("experience_gain_1")).status).toBe(401);
        expect(mocks.query).not.toHaveBeenCalled();
    });

    test("returns the catalog and its prerequisite keys with the player's points", async () => {
        const response = await fetch(baseUrl);
        const data = await response.json();
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(data.skillPoints).toBe(3);
        expect(data.unlocked).toEqual([]);
        expect(data.skills.map((skill: { key: string }) => skill.key).sort())
            .toEqual(Object.keys(skills).sort());
        expect(data.skills).toContainEqual(expect.objectContaining({
            key: "experience_gain_2", prerequisite: "experience_gain_1", cost: 2,
        }));
        for (const [key, skill] of Object.entries(skills)) {
            const prerequisites = skill.prerequisites.map(prerequisite =>
                Object.entries(skills).find(([, candidate]) => candidate === prerequisite)?.[0]);
            expect(data.skills).toContainEqual(expect.objectContaining({
                key, name: skill.name, description: skill.description, cost: skill.cost,
                effect: skill.effect,
                prerequisite: prerequisites[0] ?? null,
                prerequisites,
            }));
        }
    });

    test("rejects unknown skills, missing players, prerequisites and insufficient points", async () => {
        expect((await buy("toString")).status).toBe(404);
        expect((await buy("experience_gain_2")).status).toBe(409);
        mocks.player!.skillPoints = 0;
        expect((await buy("experience_gain_1")).status).toBe(409);
        mocks.player = null;
        expect((await fetch(baseUrl)).status).toBe(404);
        expect((await buy("experience_gain_1")).status).toBe(404);
    });

    test("deducts the cost, unlocks prerequisites and prevents repeat purchases", async () => {
        const first = await buy("experience_gain_1");
        expect(await first.json()).toEqual({ unlocked: ["experience_gain_1"], skillPoints: 2 });
        const second = await buy("experience_gain_2");
        expect(await second.json()).toEqual({
            unlocked: ["experience_gain_1", "experience_gain_2"], skillPoints: 0,
        });
        expect((await buy("experience_gain_1")).status).toBe(409);
        expect(mocks.invalidate).toHaveBeenCalledTimes(2);
        expect(mocks.query.mock.calls[0][1]).toEqual(["player-1", "experience_gain_1", 1, []]);
    });

    test("only one simultaneous purchase of the same skill succeeds", async () => {
        const responses = await Promise.all([buy("extra_income"), buy("extra_income")]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        expect(mocks.player).toEqual({ skills: ["extra_income"], skillPoints: 2 });
    });

    test("special skills require their prerequisite and deduct their listed cost", async () => {
        mocks.player = { skills: [], skillPoints: 5 };
        expect((await buy("jackpot")).status).toBe(409);
        mocks.player.skills.push("money_multiplier_2");
        const response = await buy("jackpot");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            unlocked: ["money_multiplier_2", "jackpot"], skillPoints: 0,
        });
        expect((await buy("jackpot")).status).toBe(409);
    });

    test("new companion skills require prerequisites and their full costs", async () => {
        mocks.player = { skills: [], skillPoints: 12 };
        expect((await buy("field_notes")).status).toBe(409);
        mocks.player.skills.push("scholars_fortune");
        expect((await buy("keen_senses")).status).toBe(409);
        expect((await buy("field_notes")).status).toBe(200);
        expect(mocks.player.skillPoints).toBe(7);
        expect((await buy("keen_senses")).status).toBe(200);
        expect(mocks.player.skillPoints).toBe(0);
        expect((await buy("keen_senses")).status).toBe(409);
        mocks.player = { skills: [], skillPoints: 4 };
        expect((await buy("skill_mastery_1")).status).toBe(409);
        mocks.player.skillPoints = 5;
        expect((await buy("skill_mastery_1")).status).toBe(200);
    });

    test("the companion slot skill requires Keen Senses and ten points", async () => {
        mocks.player = { skills: [], skillPoints: 10 };
        expect((await buy("companion_bond")).status).toBe(409);
        mocks.player.skills.push("keen_senses");
        mocks.player.skillPoints = 9;
        expect((await buy("companion_bond")).status).toBe(409);
        mocks.player.skillPoints = 10;
        expect((await buy("companion_bond")).status).toBe(200);
        expect(mocks.player.skillPoints).toBe(0);
    });

    test("cross-branch skills require every prerequisite before spending points", async () => {
            mocks.player = { skills: ["experience_gain_2"], skillPoints: 4 };
            expect((await buy("scholars_fortune")).status).toBe(409);
            expect(mocks.player.skillPoints).toBe(4);
            mocks.player.skills = ["extra_income_2"];
            expect((await buy("scholars_fortune")).status).toBe(409);
            expect(mocks.player.skillPoints).toBe(4);
            mocks.player.skills.push("experience_gain_2");
            const response = await buy("scholars_fortune");
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                unlocked: ["extra_income_2", "experience_gain_2", "scholars_fortune"],
                skillPoints: 1,
            });
            expect(mocks.query.mock.calls.at(-1)?.[1]).toEqual([
                "player-1", "scholars_fortune", 3, ["experience_gain_2", "extra_income_2"],
            ]);
    });

    test("a three-prerequisite skill requires all three and enough points", async () => {
            mocks.player = { skills: ["lucky_find", "skill_mastery_1"], skillPoints: 4 };
            expect((await buy("golden_breakthrough")).status).toBe(409);
            mocks.player.skills.push("experience_multiplier_1");
            mocks.player.skillPoints = 3;
            expect((await buy("golden_breakthrough")).status).toBe(409);
            mocks.player.skillPoints = 4;
            expect((await buy("golden_breakthrough")).status).toBe(200);
            expect(mocks.player.skillPoints).toBe(0);
    });
});
