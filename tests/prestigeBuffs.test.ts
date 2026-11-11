import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));

import Player from "../src/classes/Player.js";
import { getMultipleRandomPrestigeBuffs, getPrestigeBuff } from "../src/resources/functions.js";
import { PrestigeBuffs } from "../src/resources/prestigeBuffs.js";
import prestigeCommand from "../src/bot/commands/prestige.js";
import type { ChatInputCommandInteraction } from "discord.js";

afterEach(() => vi.restoreAllMocks());

describe("prestige buffs", () => {
    test("all choices have unique IDs, descriptions and positive weights", () => {
        expect(new Set(PrestigeBuffs.map(buff => buff.id)).size).toBe(PrestigeBuffs.length);
        for (const buff of PrestigeBuffs) {
            expect(buff.weight).toBeGreaterThan(0);
            expect(buff.name.length).toBeGreaterThan(0);
            expect(buff.description.length).toBeGreaterThan(0);
            expect(getPrestigeBuff(String(buff.id))).toBe(buff);
        }
    });

    test("weighted choices are distinct and sample without replacement", () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        expect(getMultipleRandomPrestigeBuffs(3).map(buff => buff.id))
            .toEqual(PrestigeBuffs.slice(0, 3).map(buff => buff.id));
        expect(getMultipleRandomPrestigeBuffs(PrestigeBuffs.length + 1)).toHaveLength(PrestigeBuffs.length);
        vi.mocked(Math.random).mockReturnValue(0.999999);
        expect(getMultipleRandomPrestigeBuffs(2).map(buff => buff.id))
            .toEqual(PrestigeBuffs.slice(-2).reverse().map(buff => buff.id));
    });

    test("existing and new reward buffs stack with skills, companions and message bonuses", () => {
        const player = new Player("Test", "1", {
            level: 10, skills: ["experience_gain_1", "extra_income", "deep_focus"],
            equippedCompanion: "mossprout",
        });
        for (const id of [1, 2, 17, 19, 21]) getPrestigeBuff(String(id)).buff(player);
        const result = player.assignRandomExperienceAndBalance(() => 0);
        expect(result.experienceAwarded).toBe(34);
        expect(result.balanceAwarded).toBe(87);
        expect(result.specialRewards).toContainEqual({ name: "Deep Focus", experience: 4 });
    });

    test("persistent buffs survive serialization and later prestiges; starting points do not", () => {
        const player = new Player("Test", "1", { level: 10, skills: ["experience_gain_1"], skillPoints: 20 });
        player.prestige();
        for (const id of [18, 20, 23, 24, 25, 26, 27, 30, 31]) getPrestigeBuff(String(id)).buff(player);
        expect(player.skillPoints).toBe(3);
        const reloaded = new Player(player.name, player.id, JSON.parse(JSON.stringify(player.toJSON())));
        expect(reloaded.prestigeExperienceFlat).toBe(6);
        expect(reloaded.prestigeBalanceFlat).toBe(20);
        expect(reloaded.prestigeCompanionSpawnMultiplier).toBeCloseTo(1.15);
        expect(reloaded.prestigeCompanionRarityMultiplier).toBeCloseTo(1.15);
        expect(reloaded.casinoPayoutMultiplier).toBeCloseTo(1.09);
        reloaded.prestige();
        expect(reloaded.skillPoints).toBe(0);
        expect(reloaded.prestigeExperienceFlat).toBe(6);
        expect(reloaded.prestigeBalanceFlat).toBe(20);
        expect(reloaded.prestigeCompanionSpawnMultiplier).toBeCloseTo(1.15);
        expect(reloaded.prestigeCompanionRarityMultiplier).toBeCloseTo(1.15);
        expect(reloaded.casinoPayoutMultiplier).toBeCloseTo(1.09);
        getPrestigeBuff("28").buff(reloaded);
        expect(reloaded.skillPoints).toBe(6);
    });

    test("legacy players receive neutral defaults", () => {
        const player = new Player("Test", "1", { level: 3 });
        expect(player.prestigeExperienceFlat).toBe(0);
        expect(player.prestigeBalanceFlat).toBe(0);
        expect(player.prestigeCompanionSpawnMultiplier).toBe(1);
        expect(player.prestigeCompanionRarityMultiplier).toBe(1);
        expect(player.casinoPayoutMultiplier).toBe(1);
        const reward = player.assignRandomExperienceAndBalance(() => 0);
        expect(reward.experienceAwarded).toBe(15);
        expect(reward.balanceAwarded).toBe(50);
    });

    test("a newly selected permanent slot is applied before skill-slot trimming", () => {
        const player = new Player("Test", "1", {
            level: 10, skills: ["companion_bond"], equippedCompanions: ["mossprout", "coinling"],
        });
        player.prestige(() => getPrestigeBuff("29").buff(player));
        expect(player.skills).toEqual([]);
        expect(player.companionSlots).toBe(2);
        expect(player.equippedCompanions).toEqual(["mossprout", "coinling"]);
        expect(player.hasPrestigeCompanionSlot).toBe(true);
    });

    test("the prestige command shows descriptions and retains stored choices", async () => {
        const choices = [getPrestigeBuff("17"), getPrestigeBuff("23"), getPrestigeBuff("27")];
        const player = new Player("Test", "1", { level: 10, temp: { prestigeBuffs: choices } });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const save = vi.spyOn(player, "save").mockResolvedValue();
        const reply = vi.fn();
        await prestigeCommand.execute({
            user: { id: player.id }, client: {}, reply,
        } as unknown as ChatInputCommandInteraction);
        expect(save).not.toHaveBeenCalled();
        const response = reply.mock.calls[0][0];
        for (const buff of choices) {
            expect(response.content).toContain(buff.description);
            expect(response.components[0].toJSON().components.map((button: { custom_id: string }) => button.custom_id))
                .toContain(`prestige_buff_${buff.id}`);
        }
    });

    test("a permanent slot is not offered again after it has been unlocked", async () => {
        const player = new Player("Test", "1", { level: 10, prestigeCompanionSlot: true });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.spyOn(player, "save").mockResolvedValue();
        vi.spyOn(Math, "random").mockReturnValue(0.999999);
        const reply = vi.fn();
        await prestigeCommand.execute({
            user: { id: player.id }, client: {}, reply,
        } as unknown as ChatInputCommandInteraction);
        expect(player.temporaryPrestigeBuffData?.map(buff => buff.id)).toEqual([35, 34, 33]);
    });
});
