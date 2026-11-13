import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    release: vi.fn(),
    del: vi.fn(),
}));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }),
    getCache: () => ({ del: mocks.del }),
}));
import Player, { PlayerConflictError } from "../src/classes/Player.js";
import { EffectOperation, getSkill } from "../src/resources/skills.js";

beforeEach(() => {
    mocks.query.mockReset();
    mocks.release.mockReset();
    mocks.del.mockReset();
});

describe("player skill persistence", () => {
    test("preserves skills and points changed since the player was loaded", async () => {
        const player = new Player("Test", "1", { skillPoints: 3 });
        mocks.query.mockResolvedValue({ rows: [{
            data: { ...player.toJSON(), skills: ["experience_gain_1"], skillPoints: 2 },
        }] });
        player.addBalance(10);
        await player.save();
        expect(mocks.query.mock.calls[0][1].slice(2)).toEqual([false, false, "[]", "3", false, 0, "[]", false, false, 0]);
        expect(mocks.query.mock.calls[0][0]).toContain("jsonb_build_object('name', COALESCE(players.data->'name', EXCLUDED.data->'name'))");
        expect(player.skills).toEqual(["experience_gain_1"]);
        expect(player.skillPoints).toBe(2);
        expect(mocks.del).toHaveBeenCalledWith("player:1");
    });

    test("rejects a conflicting explicit skill change instead of overwriting it", async () => {
        const player = new Player("Test", "1", { skillPoints: 3 });
        player.skillPoints = 2;
        player.skills = ["experience_gain_1"];
        mocks.query.mockResolvedValue({ rows: [] });
        await expect(player.save()).rejects.toBeInstanceOf(PlayerConflictError);
        expect(mocks.query.mock.calls[0][1].slice(2)).toEqual([true, true, "[]", "3", false, 0, "[]", false, false, 0]);
        expect(mocks.release).toHaveBeenCalled();
    });

    test("unlocked skills affect subsequent earnings", () => {
        const player = new Player("Test", "1", { skills: ["experience_gain_1", "extra_income"] });
        vi.spyOn(Math, "random").mockReturnValue(0);
        player.assignRandomExperienceAndBalance();
        expect(player.experience).toBe(25);
        expect(player.balance).toBe(75);
        vi.restoreAllMocks();
    });

    test("awards one point for each level and no points without a level", () => {
        const player = new Player("Test", "1", { skillPoints: 2 });
        const noLevel = player.addExperience(10);
        expect(noLevel.skillPointsGained).toBe(0);
        expect(player.skillPoints).toBe(2);
        const result = player.addExperience(1000);
        expect(result.levelsGained).toBeGreaterThan(1);
        expect(result.skillPointsGained).toBe(result.levelsGained);
        expect(player.skillPoints).toBe(2 + result.levelsGained);
    });

    test("tracks lifetime experience across levels and prestige", () => {
        const player = new Player("Test", "1", { level: 10, experience: 20 });
        const cumulativeRequirement = (level: number) => Math.floor(
            25 + 15 * level + 50 * Math.pow(1.15, level - 1),
        );
        const requiredForLevelTen = Array.from({ length: 9 }, (_, i) => cumulativeRequirement(i + 1))
            .reduce((sum, amount) => sum + amount, 0);
        expect(player.toJSON().totalExperience).toBe(requiredForLevelTen + 20);
        player.addExperience(100);
        expect(player.toJSON().totalExperience).toBe(requiredForLevelTen + 120);
        player.prestige();
        expect(player.experience).toBe(0);
        expect(player.toJSON().totalExperience).toBe(requiredForLevelTen + 120);
    });

    test("includes experience required for each prior prestige and current level", () => {
        const player = new Player("Test", "1", { prestige: 2, level: 3, experience: 40 });
        const cumulativeRequirement = (level: number) => Math.floor(
            25 + 15 * level + 50 * Math.pow(1.15, level - 1),
        );
        const expected = Array.from({ length: 9 }, (_, i) => cumulativeRequirement(i + 1))
            .concat(Array.from({ length: 19 }, (_, i) => cumulativeRequirement(i + 1)))
            .concat(cumulativeRequirement(1), cumulativeRequirement(2), 40)
            .reduce((sum, amount) => sum + amount, 0);

        expect(player.toJSON().totalExperience).toBe(expected);
    });

    test("stacks equipped casino companions, casino skills, and permanent prestige bonuses", () => {
        const player = new Player("Test", "1", {
            skills: ["house_edge_1", "house_edge_2"],
            equippedCompanions: ["vaultstag", "fatefeather"],
            prestigeCasinoPayoutMultiplier: 1.03,
        });

        expect(player.casinoPayoutMultiplier).toBeCloseTo(1.05 * 1.08 * 1.05 * 1.04 * 1.03);
    });

    test("preserves higher stored totals and persists a reconstructed legacy baseline", async () => {
        const cumulativeRequirement = (level: number) => Math.floor(
            25 + 15 * level + 50 * Math.pow(1.15, level - 1),
        );
        const requiredForLevelTen = Array.from({ length: 9 }, (_, i) => cumulativeRequirement(i + 1))
            .reduce((sum, amount) => sum + amount, 0);
        const player = new Player("Test", "1", {
            level: 10,
            experience: 20,
            totalExperience: requiredForLevelTen + 500,
        });
        expect(player.toJSON().totalExperience).toBe(requiredForLevelTen + 500);

        const legacyPlayer = new Player("Legacy", "2", { level: 10, experience: 20 });
        mocks.query.mockResolvedValue({ rows: [{ data: { ...legacyPlayer.toJSON(), name: "Legacy" } }] });
        await legacyPlayer.save();
        expect(mocks.query.mock.calls[0][1].slice(10)).toEqual([true, 20]);
    });

    test("rejects stale lifetime XP writes so concurrent rewards can retry", async () => {
        const player = new Player("Test", "1");
        player.addExperience(10);
        mocks.query.mockResolvedValue({ rows: [] });

        await expect(player.save()).rejects.toBeInstanceOf(PlayerConflictError);

        const [sql, parameters] = mocks.query.mock.calls[0];
        expect(sql).toContain("players.data->>'totalExperience'");
        expect(parameters.slice(10)).toEqual([true, 0]);
    });

    test("applies skill bonuses per level, additive before multiplier", () => {
        const player = new Player("Test", "1", {
            skills: ["skill_gain_1", "skill_mastery_1"],
            skillPoints: 4,
        });
        const result = player.addExperience(1000);
        expect(result.levelsGained).toBeGreaterThan(1);
        expect(result.skillPointsGained).toBe(result.levelsGained * 3);
        expect(player.skillPoints).toBe(4 + result.levelsGained * 3);
    });

    test("applies experience and money additions and multipliers to chat rewards", () => {
        const player = new Player("Test", "1", {
            skills: ["experience_multiplier_1", "experience_gain_1", "money_multiplier_1", "extra_income"],
        });
        vi.spyOn(Math, "random").mockReturnValue(0);
        player.assignRandomExperienceAndBalance();
        expect(player.experience).toBe(Math.floor((15 + 10) * 1.25));
        expect(player.balance).toBe(Math.floor((50 + 25) * 1.25));
        vi.restoreAllMocks();
    });

    test("prestige resets skills and points and removes their effects", () => {
        const player = new Player("Test", "1", {
            level: 10, experience: 20, balance: 100, prestige: 1, skillPoints: 5,
            skills: ["experience_gain_1", "skill_mastery_1"],
        });

        player.prestige();
        expect(player.toJSON()).toMatchObject({
            level: 1, experience: 0, balance: 100, prestige: 2, skillPoints: 0, skills: [],
        });
        const result = player.addExperience(90);
        expect(result.skillPointsGained).toBe(1);
        expect(player.skillPoints).toBe(1);
    });

    test("new reward skills stack with existing skills and reset on prestige", () => {
        const player = new Player("Test", "1", {
            level: 10, skills: ["experience_gain_1", "experience_multiplier_1", "steady_study",
                "insightful_discovery", "deep_focus", "nest_egg", "money_multiplier_1", "windfall",
                "field_notes", "keen_senses"],
        });

        const result = player.assignRandomExperienceAndBalance(key =>
            key === "baseExperience" || key === "baseBalance" || key === "windfall" ? 0 : 0.9);
        expect(result.experienceAwarded).toBe(61);
        expect(result.balanceAwarded).toBe(350);
        expect(result.specialRewards).toContainEqual({ name: "Deep Focus", experience: 6 });
        expect(result.specialRewards).toContainEqual({ name: "Windfall", balance: 250 });
        player.prestige();
        expect(player.skills).toEqual([]);
        const after = player.assignRandomExperienceAndBalance(() => 0);
        expect(after.experienceAwarded).toBe(15);
        expect(after.balanceAwarded).toBe(50);
    });

    test("windfall triggers strictly below its 1 in 50 boundary", () => {
        const skill = getSkill("windfall");
        if (!skill || skill.operation !== EffectOperation.Message) throw new Error("Missing Windfall");
        const context = {
            baseExperience: 15, baseBalance: 50, regularExperience: 15, level: 1,
            xpRequiredForNextLevel: 90, balance: 0, roll: () => 1 / 50 - Number.EPSILON,
        };
        expect(skill.messageReward(context)).toEqual({ balance: 250 });
        expect(skill.messageReward({ ...context, roll: () => 1 / 50 })).toBeNull();
    });

    test("prestige guards even an empty skill tree against concurrent purchases", async () => {
        const player = new Player("Test", "1", { level: 10 });
        player.prestige();
        mocks.query.mockResolvedValue({ rows: [] });
        await expect(player.save()).rejects.toBeInstanceOf(PlayerConflictError);
        expect(mocks.query.mock.calls[0][1].slice(2)).toEqual([true, true, "[]", "0", true, 0, "[]", true, true, 0]);
    });

    test("chat rewards guard against stale skill and prestige snapshots", async () => {
        const player = new Player("Test", "1", { prestige: 2 });
        player.assignRandomExperienceAndBalance();
        mocks.query.mockResolvedValue({ rows: [] });
        await expect(player.save()).rejects.toBeInstanceOf(PlayerConflictError);
        expect(mocks.query.mock.calls[0][1].slice(2)).toEqual([false, false, "[]", "0", true, 2, "[]", false, true, 0]);
    });
});
