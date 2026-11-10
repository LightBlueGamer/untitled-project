import { describe, expect, test, vi } from "vitest";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
import Player from "../src/classes/Player.js";

const random = (key: string) => key === "baseExperience" || key === "baseBalance" ? 0 : 0.99;

describe("cross-branch skills", () => {
    test("Scholar's Fortune adds both types of rewards using base rolls", () => {
        const player = new Player("Test", "1", { skills: ["scholars_fortune"] });
        player.assignRandomExperienceAndBalance(random);
        expect(player.experience).toBe(40);
        expect(player.balance).toBe(65);
    });

    test("Insightful Discovery adds XP and awards a point only below its threshold", () => {
        const player = new Player("Test", "1", { skills: ["insightful_discovery"] });
        const result = player.assignRandomExperienceAndBalance(key =>
            key === "insightful_discovery" ? 0 : random(key));
        expect(player.experience).toBe(18);
        expect(player.skillPoints).toBe(1);
        expect(result.specialRewards).toContainEqual({
            name: "Insightful Discovery", experience: 3, skillPoints: 1, announce: true,
        });
        const noDiscovery = new Player("Test", "2", { skills: ["insightful_discovery"] });
        noDiscovery.assignRandomExperienceAndBalance(key =>
            key === "insightful_discovery" ? 1 / 500 : random(key));
        expect(noDiscovery.experience).toBe(18);
        expect(noDiscovery.skillPoints).toBe(0);
    });

    test("Insightful Discovery adds 20% of regular modified XP, independent of other message-skill order", () => {
        for (const skills of [
            ["experience_gain_1", "experience_multiplier_1", "inspiration", "insightful_discovery"],
            ["insightful_discovery", "experience_multiplier_1", "experience_gain_1", "inspiration"],
        ]) {
            const player = new Player("Test", "1", { level: 2, skills });
            const result = player.assignRandomExperienceAndBalance(key => key === "inspiration" ? 0 : random(key));
            const regularXP = (15 + 10) * 1.25;
            expect(player.experience).toBe(Math.floor(regularXP + Math.floor(regularXP * 0.2) + 45));
            expect(result.specialRewards.find(reward => reward.name === "Insightful Discovery")?.experience)
                .toBe(Math.floor(regularXP * 0.2));
            expect(player.skillPoints).toBe(0);
        }
    });

    test("Golden Breakthrough awards both bonuses at its stated odds", () => {
        const player = new Player("Test", "1", { skills: ["golden_breakthrough"] });
        player.assignRandomExperienceAndBalance(key => key === "golden_breakthrough" ? 0 : random(key));
        expect(player.experience).toBe(45);
        expect(player.balance).toBe(150);
        const miss = new Player("Test", "2", { skills: ["golden_breakthrough"] });
        miss.assignRandomExperienceAndBalance(key => key === "golden_breakthrough" ? 1 / 20 : random(key));
        expect(miss.experience).toBe(15);
        expect(miss.balance).toBe(50);
    });

    test("prestige removes cross-branch effects", () => {
        const player = new Player("Test", "1", { skills: ["scholars_fortune", "insightful_discovery"] });
        player.prestige();
        player.assignRandomExperienceAndBalance(random);
        expect(player.skills).toEqual([]);
        expect(player.experience).toBe(15);
        expect(player.balance).toBe(50);
    });
});
