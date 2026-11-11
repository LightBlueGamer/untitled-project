import { afterEach, describe, expect, test, vi } from "vitest";
import type { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction } from "discord.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/companionStorage.js", () => ({
    equipCompanion: vi.fn(), unequipCompanion: vi.fn(), obtainCompanion: vi.fn(), loseCompanion: vi.fn(),
}));

import Player from "../src/classes/Player.js";
import { equipCompanion, unequipCompanion } from "../src/companionStorage.js";
import { companions } from "../src/resources/companions.js";
import command, { companionList, handleCompanionListButton } from "../src/bot/commands/companion.js";
import autocomplete from "../src/bot/events/autoCompleteInteraction.js";

afterEach(() => vi.restoreAllMocks());

describe("companion command", () => {
    const inventory = Object.keys(companions).slice(0, 11).map(key => ({ key, quantity: 2 }));
    const player = new Player("Test", "123", { equippedCompanion: "mossprout" }, inventory);

    test("pages inventory at ten species and shows stats and equipment", () => {
        const first = companionList(player, 0);
        const second = companionList(player, 1);
        expect(first.embeds[0].data.description?.match(/\*\*/g)).toHaveLength(20);
        expect(first.embeds[0].data.description).toContain("Mossprout** ×2 (Common · Equipped)");
        expect(first.embeds[0].data.description).toContain("HP 45 · DMG 12 · DEF 18 · SPD 16 · CRIT 3");
        expect(first.embeds[0].data.footer?.text).toBe("Page 1 of 2 · 1/1 equipped");
        expect(first.components[0].components.map(button => button.data.disabled)).toEqual([true, false]);
        expect(second.embeds[0].data.description?.match(/\*\*/g)).toHaveLength(2);
        expect(second.components[0].components.map(button => button.data.disabled)).toEqual([false, true]);
        expect(companionList(player, 99).embeds[0].data.footer?.text).toBe("Page 2 of 2 · 1/1 equipped");
        expect(companionList(new Player("Test", "123"), 0).embeds[0].data.description).toBe("You have no companions yet.");
    });

    test("pagination checks ownership and reloads current inventory", async () => {
        const lookup = vi.spyOn(Player, "findById").mockResolvedValue(player);
        const reply = vi.fn();
        const update = vi.fn();
        const button = { customId: "companion_list:123:1", user: { id: "999" }, reply, update } as unknown as ButtonInteraction;
        await handleCompanionListButton(button);
        expect(reply).toHaveBeenCalledOnce();
        expect(lookup).not.toHaveBeenCalled();
        Object.assign(button, { user: { id: "123" } });
        await handleCompanionListButton(button);
        expect(lookup).toHaveBeenCalledWith("123");
        expect(update.mock.calls[0][0].embeds[0].data.footer.text).toBe("Page 2 of 2 · 1/1 equipped");
        Object.assign(button, { customId: "companion_list:123:0:previous" });
        await handleCompanionListButton(button);
        expect(update.mock.lastCall?.[0].embeds[0].data.footer.text).toBe("Page 1 of 2 · 1/1 equipped");
        Object.assign(button, { customId: "companion_list:123:1:next" });
        await handleCompanionListButton(button);
        expect(update.mock.lastCall?.[0].embeds[0].data.footer.text).toBe("Page 2 of 2 · 1/1 equipped");
    });

    test.each([
        ["empty", []],
        ["one companion", [{ key: "mossprout", quantity: 1 }]],
        ["one full page", Object.keys(companions).slice(0, 10).map(key => ({ key, quantity: 1 }))],
    ])("sends a %s collection with unique disabled navigation buttons", async (_label, owned) => {
        const player = new Player("Test", "123", {}, owned);
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const editReply = vi.fn(async payload => {
            const buttons = payload.components[0].toJSON().components;
            expect(new Set(buttons.map(button => button.custom_id)).size).toBe(buttons.length);
            expect(buttons.map(button => button.disabled)).toEqual([true, true]);
        });
        const interaction = {
            user: { id: "123" }, client: {}, options: { getSubcommand: () => "list" },
            deferReply: vi.fn(), editReply,
        } as unknown as ChatInputCommandInteraction;
        await command.execute(interaction);
        expect(editReply).toHaveBeenCalledOnce();
        expect(editReply.mock.calls[0][0].embeds[0].data.title).toBe("Your companions");
    });

    test("equip checks ownership and reports result", async () => {
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.mocked(equipCompanion).mockResolvedValueOnce("unowned").mockResolvedValueOnce("equipped");
        const editReply = vi.fn();
        const interaction = {
            user: { id: "123" },
            options: { getSubcommand: () => "equip", getString: () => "mossprout" },
            deferReply: vi.fn(), editReply,
        } as unknown as ChatInputCommandInteraction;
        await command.execute(interaction);
        expect(editReply).toHaveBeenLastCalledWith({ content: "You do not own that companion." });
        await command.execute(interaction);
        expect(editReply).toHaveBeenLastCalledWith({ content: expect.stringContaining("Equipped Mossprout") });
        expect(equipCompanion).toHaveBeenCalledWith("123", "mossprout");
    });

    test("autocomplete only suggests owned matching companions", async () => {
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const respond = vi.fn();
        const interaction = {
            commandName: "companion", user: { id: "123" }, respond,
            options: { getSubcommand: () => "equip", getFocused: () => "moss" },
        } as unknown as AutocompleteInteraction;
        await autocomplete.execute(interaction);
        expect(respond).toHaveBeenCalledWith([{ name: "Mossprout", value: "mossprout" }]);
    });

    test("reports full slots and lets the user unequip", async () => {
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.mocked(equipCompanion).mockResolvedValue("full");
        vi.mocked(unequipCompanion).mockResolvedValue("unequipped");
        let subcommand = "equip";
        const editReply = vi.fn();
        const interaction = {
            user: { id: "123" }, options: { getSubcommand: () => subcommand, getString: () => "mossprout" },
            deferReply: vi.fn(), editReply,
        } as unknown as ChatInputCommandInteraction;
        await command.execute(interaction);
        expect(editReply).toHaveBeenLastCalledWith({ content: expect.stringContaining("/companion unequip") });
        subcommand = "unequip";
        await command.execute(interaction);
        expect(editReply).toHaveBeenLastCalledWith({ content: "Unequipped Mossprout." });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const respond = vi.fn();
        await autocomplete.execute({
            commandName: "companion", user: { id: "123" }, respond,
            options: { getSubcommand: () => "unequip", getFocused: () => "" },
        } as unknown as AutocompleteInteraction);
        expect(respond).toHaveBeenCalledWith([{ name: "Mossprout", value: "mossprout" }]);
    });

    test("all equipped bonuses stack; inventory alone grants nothing", () => {
        const multiple = new Player("Test", "1", {
            level: 2, prestigeCompanionSlot: true, skills: ["companion_bond"],
            equippedCompanions: ["mossprout", "sparkit", "solmane"],
        }, [{ key: "runowl", quantity: 1 }]);
        const result = multiple.assignRandomExperienceAndBalance(() => 0);
        expect(result.experienceAwarded).toBe(Math.floor((15 + 4) * 1.05 * 1.15));
        expect(result.balanceAwarded).toBe(50);
        expect(multiple.addExperience(1000).skillPointsGained).toBeGreaterThan(0);
        const skillPets = new Player("Test", "2", {
            prestigeCompanionSlot: true, equippedCompanions: ["runowl", "chronowing"],
        });
        const levels = skillPets.addExperience(1000);
        expect(levels.skillPointsGained).toBe(levels.levelsGained * 3);
    });

    test("large inventories remain pageable and searchable within Discord limits", async () => {
        const owned = Object.keys(companions).sort().map(key => ({ key, quantity: 1 }));
        const collector = new Player("Test", "123", {}, owned);
        const pages = Math.ceil(owned.length / 10);
        for (let page = 0; page < pages; page++) {
            const view = companionList(collector, page);
            expect(view.embeds[0].toJSON().description!.length).toBeLessThanOrEqual(4096);
            expect(view.embeds[0].data.description!.match(/\*\*/g)!.length).toBeLessThanOrEqual(20);
        }
        expect(companionList(collector, pages - 1).embeds[0].data.footer?.text).toBe(`Page ${pages} of ${pages} · 0/1 equipped`);
        vi.spyOn(Player, "findById").mockResolvedValue(collector);
        const respond = vi.fn();
        const interaction = {
            commandName: "companion", user: { id: "123" }, respond,
            options: { getSubcommand: () => "equip", getFocused: () => "chronosage" },
        } as unknown as AutocompleteInteraction;
        await autocomplete.execute(interaction);
        expect(respond).toHaveBeenCalledWith([{ name: "Chronosage", value: "chronosage" }]);
        Object.assign(interaction.options, { getFocused: () => "" });
        await autocomplete.execute(interaction);
        expect(respond.mock.lastCall?.[0]).toHaveLength(25);
    });

    test("equipped bonuses modify message rewards and skill points per level", () => {
        const xp = new Player("Test", "1", { equippedCompanion: "solmane", skills: ["experience_gain_1"] });
        xp.assignRandomExperienceAndBalance(() => 0.99);
        expect(xp.experience).toBe(Math.floor((40 + 10) * 1.15));
        const flatXp = new Player("Test", "2", { equippedCompanion: "sparkit" });
        flatXp.assignRandomExperienceAndBalance(() => 0);
        expect(flatXp.experience).toBe(19);
        const money = new Player("Test", "3", { equippedCompanion: "coinling" });
        const moneyReward = money.assignRandomExperienceAndBalance(() => 0);
        expect(money.balance).toBe(52);
        expect(moneyReward.balanceAwarded).toBe(52);
        const flatMoney = new Player("Test", "4", { equippedCompanion: "burrowbuck" });
        flatMoney.assignRandomExperienceAndBalance(() => 0);
        expect(flatMoney.balance).toBe(62);
        const skill = new Player("Test", "5", { equippedCompanion: "runowl", skills: ["skill_mastery_1"] });
        const result = skill.addExperience(1000);
        expect(result.skillPointsGained).toBe(result.levelsGained * 3);
    });

    test("rounds the total money reward down after skills and companion bonuses", () => {
        const player = new Player("Test", "1", {
            skills: ["extra_income", "money_multiplier_1", "scholars_fortune"],
            equippedCompanion: "coinling",
        });
        const reward = player.assignRandomExperienceAndBalance(() => 0);
        const total = (50 + 25) * 1.25 * 1.05 + 15;
        expect(reward.balanceAwarded).toBe(Math.floor(total));
        expect(player.balance).toBe(Math.floor(total));
    });
});
