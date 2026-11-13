import { describe, expect, test, vi } from "vitest";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
import Player from "../src/classes/Player.js";

const original = (level: number) => Math.floor(25 + 15 * level + 50 * Math.pow(1.15, level - 1));

describe("level XP curve", () => {
    test.each([[1, 1], [9, 1], [10, 1], [11, 2], [20, 2], [21, 3], [30, 3], [31, 4], [99, 10], [100, 10], [101, 11]])(
        "applies the correct ten-level multiplier at level %i", (level, multiplier) => {
            const player = new Player("Test", "1");
            expect(player.xpForNextLevel(level)).toBe(original(level) * multiplier);
        },
    );

    test("preserves existing progress and uses the new threshold on the next award", () => {
        const player = new Player("Test", "1", { level: 11, experience: original(11) - 1, skillPoints: 7 });
        expect(player.level).toBe(11);
        expect(player.skillPoints).toBe(7);
        expect(player.experience).toBe(original(11) - 1);
        expect(player.addExperience(1).didLevelUp).toBe(false);
        expect(player.experience).toBe(original(11));
        const result = player.addExperience(original(11));
        expect(result.didLevelUp).toBe(true);
        expect(result.skillPointsGained).toBe(1);
        expect(player.level).toBe(12);
        expect(player.skillPoints).toBe(8);
        expect(player.experience).toBe(0);
    });

    test("does not inflate historical lifetime XP from the harder curve", () => {
        const previous = Array.from({ length: 20 }, (_, i) => original(i + 1)).reduce((a, b) => a + b, 0);
        const player = new Player("Test", "1", { level: 21, experience: 10, totalExperience: previous + 10 });
        expect(player.toJSON().totalExperience).toBe(previous + 10);
        player.addExperience(1);
        expect(player.toJSON().totalExperience).toBe(previous + 11);
    });

    test("reconstructs missing historical XP using the original curve", () => {
        const previous = Array.from({ length: 20 }, (_, i) => original(i + 1)).reduce((a, b) => a + b, 0);
        const player = new Player("Test", "1", { level: 21, experience: 10 });
        expect(player.toJSON().totalExperience).toBe(previous + 10);
    });

    test("Momentum scales with the new level requirement", () => {
        const player = new Player("Test", "1", { level: 21, skills: ["momentum"] });
        const result = player.assignRandomExperienceAndBalance(() => 0);
        const bonus = Math.floor(original(21) * 3 / 100);
        expect(result.specialRewards).toEqual([{ name: "Momentum", experience: bonus }]);
        expect(result.experienceAwarded).toBe(15 + bonus);
    });
});
