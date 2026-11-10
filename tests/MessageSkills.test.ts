import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/database.js", () => ({
    getPool: vi.fn(),
    getCache: vi.fn(),
}));

import Player from "../src/classes/Player.js";
import { EffectOperation, getSkill } from "../src/resources/skills.js";

afterEach(() => vi.restoreAllMocks());

const randomFor = (values: Record<string, number>) => (key: string) => values[key] ?? 0.99;

describe("message skill effects", () => {
    test.each([
        ["jackpot", 1 / 10000],
        ["lucky_find", 1 / 20],
        ["compound_interest", 1 / 25],
        ["inspiration", 1 / 15],
        ["discovery", 1 / 200],
    ])("%s uses the specified probability boundary", (key, chance) => {
        const skill = getSkill(key);
        if (!skill || skill.operation !== EffectOperation.Message) throw new Error("Missing message skill");
        const context = {
            baseExperience: 15, baseBalance: 50, regularExperience: 15, level: 1,
            xpRequiredForNextLevel: 90, balance: 10000,
            roll: () => chance - Number.EPSILON,
        };
        const hit = skill.messageReward(context);
        const miss = skill.messageReward({ ...context, roll: () => chance });
        if (key === "jackpot") {
            expect(hit).toEqual({ balance: 5025, announce: true });
            expect(miss).toEqual({ balance: 25 });
        } else {
            expect(hit).not.toBeNull();
            expect(miss).toBeNull();
        }
    });

    test("jackpot adds 100 times the original money roll plus its guaranteed bonus", () => {
        const player = new Player("Test", "1", {
            skills: ["extra_income", "money_multiplier_1", "jackpot"],
        });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, jackpot: 0,
        }));
        expect(player.balance).toBe(Math.floor((50 + 25) * 1.25 + 25 + 5000));
        expect(result.specialRewards).toContainEqual({ name: "Jackpot", balance: 5025, announce: true });
    });

    test("the effects do not apply or roll unless the skill is owned", () => {
        const player = new Player("Test", "1");
        const random = vi.fn(randomFor({ baseExperience: 0, baseBalance: 0 }));
        const result = player.assignRandomExperienceAndBalance(random);
        expect(player.balance).toBe(50);
        expect(player.experience).toBe(15);
        expect(result.specialRewards).toEqual([]);
        expect(random.mock.calls.map(([key]) => key)).toEqual(["baseExperience", "baseBalance"]);
    });

    test("lucky find, inspiration and momentum stack with ordinary skills using base rolls", () => {
        const player = new Player("Test", "1", {
            level: 5, skills: ["extra_income", "experience_gain_1", "lucky_find", "inspiration", "momentum"],
        });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, lucky_find: 0, inspiration: 0, momentum: 0,
        }));
        expect(player.balance).toBe(50 + 25 + 100);
        expect(player.experience).toBe(15 + 10 + 45 + Math.floor(player.xpForNextLevel(5) * 0.01));
        expect(result.specialRewards.map(reward => reward.name)).toEqual(["Lucky Find", "Inspiration", "Momentum"]);
    });

    test("interest uses the balance before rewards and is capped at 1000", () => {
        const player = new Player("Test", "1", { balance: 200000, skills: ["compound_interest"] });
        player.assignRandomExperienceAndBalance(randomFor({ baseExperience: 0, baseBalance: 0, compound_interest: 0 }));
        expect(player.balance).toBe(201050);
        const small = new Player("Test", "2", { balance: 1250, skills: ["compound_interest"] });
        small.assignRandomExperienceAndBalance(randomFor({ baseExperience: 0, baseBalance: 0, compound_interest: 0 }));
        expect(small.balance).toBe(1312);
    });

    test("momentum uses the full next-level requirement before the message and can level up", () => {
        const player = new Player("Test", "1", { level: 2, experience: 40, skills: ["momentum", "skill_mastery_1"] });
        const required = player.xpForNextLevel(2);
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, momentum: (1 - Number.EPSILON) / 1000,
        }));
        expect(result.specialRewards).toContainEqual({ name: "Momentum", experience: required });
        expect(player.level).toBe(3);
        expect(player.experience).toBe(55);
        expect(result.levelsGained).toBe(1);
        expect(result.skillPointsGained).toBe(2);
        expect(player.skillPoints).toBe(2);
    });

    test("momentum and the final message award round fractional XP down", () => {
        const player = new Player("Test", "1", { skills: ["experience_multiplier_1", "momentum"] });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, momentum: 0,
        }));
        expect(result.specialRewards).toContainEqual({ name: "Momentum", experience: 0 });
        expect(player.experience).toBe(18);
    });

    test("rounds message XP before checking for level-ups", () => {
        const player = new Player("Test", "1", {
            experience: 71, skills: ["experience_multiplier_1", "momentum"],
        });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, momentum: 0,
        }));
        expect(player.experience).toBe(89);
        expect(result.didLevelUp).toBe(false);
    });

    test("momentum weights all whole percentages toward lower rewards", () => {
        const skill = getSkill("momentum");
        if (!skill || skill.operation !== EffectOperation.Message) throw new Error("Missing momentum skill");
        const weights = Array.from({ length: 100 }, (_, index) => 1 / (index + 1) ** 2);
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        const context = {
            baseExperience: 15, baseBalance: 50, regularExperience: 15, level: 1,
            xpRequiredForNextLevel: 90, balance: 0, roll: () => 0,
        };
        let cumulative = 0;
        for (const [index, weight] of weights.entries()) {
            const roll = (cumulative + weight / 2) / total;
            expect(skill.messageReward({ ...context, roll: () => roll / 1000 })?.experience)
                .toBe(Math.floor(90 * (index + 1) / 100));
            const beforeEnd = (cumulative + weight * 0.99999) / total;
            expect(skill.messageReward({ ...context, roll: () => beforeEnd / 1000 })?.experience)
                .toBe(Math.floor(90 * (index + 1) / 100));
            if (index > 0) expect(weight).toBeLessThan(weights[index - 1]);
            cumulative += weight;
        }
        expect(skill.messageReward(context)?.experience).toBe(0);
        expect(skill.messageReward({ ...context, roll: () => (1 - Number.EPSILON) / 1000 })?.experience).toBe(90);
        expect(weights[0] / total).toBeGreaterThan(0.6);
        expect(weights[99] / total).toBeLessThan(0.0001);
    });

    test("momentum activates only below the 1 in 1000 threshold", () => {
        const skill = getSkill("momentum");
        if (!skill || skill.operation !== EffectOperation.Message) throw new Error("Missing momentum skill");
        const context = {
            baseExperience: 15, baseBalance: 50, regularExperience: 15, level: 1,
            xpRequiredForNextLevel: 10000, balance: 0, roll: () => 0,
        };
        expect(skill.messageReward(context)).toEqual({ experience: 100 });
        expect(skill.messageReward({ ...context, roll: () => 1 / 1000 - Number.EPSILON })?.experience).toBe(10000);
        expect(skill.messageReward({ ...context, roll: () => 1 / 1000 })).toBeNull();
        expect(skill.messageReward({ ...context, roll: () => 0.5 })).toBeNull();
        const player = new Player("Test", "1", { skills: ["momentum"] });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, momentum: 1 / 1000,
        }));
        expect(player.experience).toBe(15);
        expect(result.specialRewards).toEqual([]);
    });

    test("discovery is independent of level-up point multipliers", () => {
        const player = new Player("Test", "1", {
            experience: 75, skillPoints: 4, skills: ["skill_mastery_1", "skill_gain_1", "discovery"],
        });
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, discovery: 0,
        }));
        expect(result.skillPointsGained).toBe(3);
        expect(result.bonusSkillPoints).toBe(1);
        expect(player.skillPoints).toBe(8);
        expect(result.specialRewards).toContainEqual({ name: "Discovery", skillPoints: 1, announce: true });
    });

    test("prestige removes message skills and their effects", () => {
        const player = new Player("Test", "1", { skills: ["jackpot", "momentum", "discovery"] });
        player.prestige();
        const result = player.assignRandomExperienceAndBalance(randomFor({
            baseExperience: 0, baseBalance: 0, jackpot: 0, discovery: 0,
        }));
        expect(player.balance).toBe(50);
        expect(player.experience).toBe(15);
        expect(player.skillPoints).toBe(0);
        expect(result.specialRewards).toEqual([]);
    });
});
