import { afterEach, describe, expect, test, vi } from "vitest";
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/lootboxStorage.js", () => ({
    getLootboxInventory: vi.fn(),
    openLootbox: vi.fn(),
    useLootboxBoost: vi.fn(),
}));

import Player from "../src/classes/Player.js";
import { getLootboxInventory, openLootbox, useLootboxBoost } from "../src/lootboxStorage.js";
import command from "../src/bot/commands/lootbox.js";
import autocomplete from "../src/bot/events/autoCompleteInteraction.js";
import { Rarity } from "../src/resources/rarities.js";

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WEBSITE_URL;
});

describe("lootbox command", () => {
    test("reports a saved reward when inventory is full", async () => {
        vi.spyOn(Player, "get").mockResolvedValue(new Player("Test", "1"));
        vi.mocked(openLootbox).mockResolvedValue({ status: "full" });
        const editReply = vi.fn();
        await command.execute({
            user: { id: "1" }, client: {}, deferReply: vi.fn(), editReply,
            options: { getSubcommand: () => "open", getString: () => "4" },
        } as unknown as ChatInputCommandInteraction);
        expect(editReply).toHaveBeenCalledWith(expect.stringContaining("item reward is saved"));
    });

    test("links to item rewards and describes activated boosts", async () => {
        process.env.WEBSITE_URL = "https://game.example";
        vi.spyOn(Player, "get").mockResolvedValue(new Player("Test", "1"));
        vi.mocked(openLootbox).mockResolvedValue({ status: "opened", reward: { type: "item", key: "wild_berries" } });
        const editReply = vi.fn();
        const base = { user: { id: "1" }, client: {}, deferReply: vi.fn(), editReply };
        await command.execute({
            ...base, options: { getSubcommand: () => "open", getString: () => "4" },
        } as unknown as ChatInputCommandInteraction);
        expect(editReply).toHaveBeenCalledWith(expect.stringContaining("https://game.example/item?key=wild_berries"));
        vi.mocked(useLootboxBoost).mockResolvedValue({
            id: "5", bonus_type: "lootboxFind", multiplier: 1.2, duration_minutes: 30,
        });
        await command.execute({
            ...base, options: { getSubcommand: () => "boost", getString: () => "5" },
        } as unknown as ChatInputCommandInteraction);
        expect(editReply).toHaveBeenLastCalledWith(expect.stringContaining("for 30 minutes"));
    });

    test("autocomplete suggests the user's matching boxes", async () => {
        vi.mocked(getLootboxInventory).mockResolvedValue({
            boxes: [{ id: "12", rarity: Rarity.Rare, pending_reward: null }],
            boosts: [],
        });
        const respond = vi.fn();
        await autocomplete.execute({
            commandName: "lootbox", user: { id: "1" }, respond,
            options: { getSubcommand: () => "open", getFocused: () => "rare" },
        } as unknown as AutocompleteInteraction);
        expect(respond).toHaveBeenCalledWith([{ name: "Rare lootbox #12", value: "12" }]);
    });
});
