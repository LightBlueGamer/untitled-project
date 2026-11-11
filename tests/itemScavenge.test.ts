import { describe, expect, test } from "vitest";
import Player from "../src/classes/Player.js";
import { calculateScavengeWeights, getScavengeCooldownMs, scavengeCooldownMs, scavengeExperience, scavengeOdds } from "../src/itemStorage.js";
import { items, tools } from "../src/resources/items.js";
import { formatRemaining } from "../src/bot/commands/scavenge.js";

describe("scavenging", () => {
    test("weights are reduced by circulation and improved by rarity skills and tools", () => {
        const player = new Player("Test", "1");
        const candidates = [
            { key: "wild_berries", item: items.wild_berries },
            { key: "sunstone", item: items.sunstone },
        ];
        const noTool = calculateScavengeWeights(candidates, new Map(), [], player, []);
        const crowded = calculateScavengeWeights(
            candidates, new Map([["sunstone", 9_900]]), [], player, [],
        );
        expect(crowded[1]).toBeLessThan(noTool[1]);
        expect(crowded[0]).toBeCloseTo(noTool[0]);

        const raritySkilled = new Player("Test", "2", { skills: ["scavenging_efficiency", "rare_finder"] });
        const skillWeights = calculateScavengeWeights(candidates, new Map(), [], raritySkilled, []);
        expect(skillWeights[0]).toBeCloseTo(noTool[0]);
        expect(skillWeights[1]).toBeCloseTo(noTool[1] * 1.2);
        expect(getScavengeCooldownMs(new Player("Test", "3"))).toBe(scavengeCooldownMs);
        expect(getScavengeCooldownMs(raritySkilled)).toBe(Math.floor(scavengeCooldownMs * 0.85));

        const withPick = calculateScavengeWeights(
            [{ key: "iron_ore", item: items.iron_ore }],
            new Map(),
            [tools.iron_pick],
            player,
            [],
        );
        const withoutPick = calculateScavengeWeights(
            [{ key: "iron_ore", item: items.iron_ore }], new Map(), [], player, [],
        );
        expect(withPick[0]).toBeGreaterThan(withoutPick[0]);
    });

    test("tool mastery adds a tool slot and cooldown responses show remaining time", () => {
        expect(new Player("Test", "1").toolSlots).toBe(1);
        expect(new Player("Test", "2", { skills: ["scavenging_efficiency", "rare_finder", "extra_find", "tool_mastery"] }).toolSlots)
            .toBe(2);
        expect(scavengeCooldownMs).toBe(5 * 60 * 1000);
        expect(formatRemaining(121_001)).toBe("2 minutes and 2 seconds");
        expect(formatRemaining(1_200)).toBe("2 seconds");
    });

    test("consumables grant timed scavenging effects", () => {
        expect(items.trail_rations.consumableBonus).toMatchObject({
            type: "extraFindChance",
            multiplier: 0.05,
            durationMinutes: 25,
        });
        expect(items.moonleaf.consumableBonus?.type).toBe("scavengeRarity");
    });

    test("odds use normalized actual weights and scavenging XP scales with rarity, price and quantity", () => {
        expect(scavengeOdds([1, 3, 0])).toEqual([4, 4 / 3, null]);
        expect(() => scavengeOdds([0, 0])).toThrow();
        const common = items.wild_berries;
        const rare = items.sunstone;
        expect(scavengeExperience(rare, 1)).toBeGreaterThan(scavengeExperience(common, 1));
        expect(scavengeExperience({ ...common, price: common.price * 100 }, 1))
            .toBeGreaterThan(scavengeExperience(common, 1));
        expect(scavengeExperience(common, 2)).toBe(scavengeExperience(common, 1) * 2);
        const base = new Player("Test", "1").addScavengeExperience(100);
        const skilled = new Player("Test", "2", { skills: ["scavenging_experience"] }).addScavengeExperience(100);
        expect(base.experienceAwarded).toBe(100);
        expect(skilled.experienceAwarded).toBe(125);
        expect(skilled.progression.didLevelUp).toBe(true);
        const both = new Player("Test", "3", { skills: ["scavenging_experience", "scavenging_experience_2"] })
            .addScavengeExperience(100);
        expect(both.experienceAwarded).toBe(168);
    });
});
