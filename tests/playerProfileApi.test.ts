import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
import Player from "../src/classes/Player.js";
import router from "../src/api/routes/player.js";

let server: Server;
let url: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/players", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/players`;
});

afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("player profile XP", () => {
    test("reports permanent bonus sources and combined ordinary message rewards", async () => {
        const player = new Player("Test", "1", {
            prestigeExperienceFlat: 3, prestigeBalanceFlat: 10, experienceMultiplier: 1.2, balanceMultiplier: 1.1,
            prestigeCasinoPayoutMultiplier: 1.2, prestigeCompanionSlot: true,
            skills: ["experience_gain_1", "experience_multiplier_1", "extra_income", "money_multiplier_1"],
            equippedCompanions: ["sparkit", "coinling"],
        });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const response = await fetch(`${url}/1`);
        const { profileBonuses } = await response.json();
        expect(profileBonuses.messageRewards.experience.multiplier).toBeCloseTo(1.5);
        expect(profileBonuses.messageRewards.experience.flat).toBeCloseTo(23.5);
        expect(profileBonuses.messageRewards.balance.multiplier).toBeCloseTo(1.44375);
        expect(profileBonuses.messageRewards.balance.flat).toBeCloseTo(50.53125);
        expect(profileBonuses.prestige.map((bonus: { name: string }) => bonus.name)).toEqual(expect.arrayContaining(["Prestige XP", "Prestige income", "Casino payouts", "Companion slot"]));
        expect(profileBonuses.skills.map((bonus: { name: string }) => bonus.name)).toContain("Experience Gain I");
        expect(profileBonuses.companions.map((bonus: { name: string }) => bonus.name)).toEqual(["Sparkit", "Coinling"]);
        const result = player.assignRandomExperienceAndBalance(() => 0);
        expect(result.experienceAwarded).toBe(Math.floor(15 * profileBonuses.messageRewards.experience.multiplier + profileBonuses.messageRewards.experience.flat));
        expect(result.balanceAwarded).toBe(Math.floor(50 * profileBonuses.messageRewards.balance.multiplier + profileBonuses.messageRewards.balance.flat));
        vi.restoreAllMocks();
    });

    test("reports only active companion effects and does not include conditional message rewards in the base formula", () => {
        const player = new Player("Test", "1", { skills: ["discovery"], equippedCompanions: ["sparkit"] },
            [{ key: "sparkit", quantity: 1 }, { key: "coinling", quantity: 1 }]);
        const bonuses = player.profileBonuses;
        expect(bonuses.companions.map(companion => companion.name)).toEqual(["Sparkit"]);
        expect(bonuses.skills.map(skill => skill.name)).toContain("Discovery");
        expect(bonuses.messageRewards.experience.multiplier).toBe(1);
        expect(bonuses.messageRewards.experience.flat).toBe(4);
        expect(bonuses.messageRewards.balance.flat).toBe(0);
    });

    test("reports exact rounded ordinary reward and bonus ranges for every possible base roll", () => {
        const data = {
            prestigeExperienceFlat: 3, prestigeBalanceFlat: 10, experienceMultiplier: 1.2, balanceMultiplier: 1.1,
            skills: ["experience_gain_1", "experience_multiplier_1", "extra_income", "money_multiplier_1"],
            equippedCompanions: ["sparkit", "coinling"],
        };
        const profile = new Player("Test", "1", data).profileBonuses.messageRewards;
        const xpRewards: number[] = [], xpBonuses: number[] = [], xpAdditive: number[] = [];
        const moneyRewards: number[] = [], moneyBonuses: number[] = [], moneyAdditive: number[] = [];
        for (let base = 15; base <= 40; base++) {
            const player = new Player("Test", "1", data);
            const result = player.assignRandomExperienceAndBalance(key => key === "baseExperience" ? (base - 15 + 0.5) / 26 : 0);
            xpRewards.push(result.experienceAwarded);
            xpBonuses.push(result.experienceAwarded - base);
            xpAdditive.push(result.experienceAwarded - Math.floor(base * profile.experience.multiplier));
        }
        for (let base = 50; base <= 150; base++) {
            const player = new Player("Test", "1", data);
            const result = player.assignRandomExperienceAndBalance(key => key === "baseBalance" ? (base - 50 + 0.5) / 101 : 0);
            moneyRewards.push(result.balanceAwarded);
            moneyBonuses.push(result.balanceAwarded - base);
            moneyAdditive.push(result.balanceAwarded - Math.floor(base * profile.balance.multiplier));
        }
        const range = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
        expect(profile.experience.reward).toEqual(range(xpRewards));
        expect(profile.experience.bonus).toEqual(range(xpBonuses));
        expect(profile.experience.additiveBonus).toEqual(range(xpAdditive));
        expect(profile.balance.reward).toEqual(range(moneyRewards));
        expect(profile.balance.bonus).toEqual(range(moneyBonuses));
        expect(profile.balance.additiveBonus).toEqual(range(moneyAdditive));
        expect(new Player("Test", "2").profileBonuses.messageRewards).toMatchObject({
            experience: { reward: { min: 15, max: 40 }, bonus: { min: 0, max: 0 }, additiveBonus: { min: 0, max: 0 } },
            balance: { reward: { min: 50, max: 150 }, bonus: { min: 0, max: 0 }, additiveBonus: { min: 0, max: 0 } },
        });
    });
    test.each([1, 5, 20])("includes the current level's requirement at level %i", async level => {
        const player = new Player("Test", "1", { level, experience: 25 });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const response = await fetch(`${url}/1`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            level, experience: 25, requiredXP: player.xpForNextLevel(level),
        });
        vi.restoreAllMocks();
    });

    test("preserves the not-found response", async () => {
        vi.spyOn(Player, "findById").mockResolvedValue(null);
        expect((await fetch(`${url}/missing`)).status).toBe(404);
        vi.restoreAllMocks();
    });
});
