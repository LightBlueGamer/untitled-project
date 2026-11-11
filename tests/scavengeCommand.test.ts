import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/itemStorage.js", () => ({ scavengeForPlayer: vi.fn() }));

import Player from "../src/classes/Player.js";
import { scavengeForPlayer } from "../src/itemStorage.js";
import { items } from "../src/resources/items.js";
import command from "../src/bot/commands/scavenge.js";
import { levelUpMessage } from "../src/bot/levelUp.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.WEBSITE_URL;
});

describe("scavenge command", () => {
    test("publishes a lasting result with item link, actual odds and XP; level-up expires separately", async () => {
        vi.useFakeTimers();
        process.env.WEBSITE_URL = "https://game.example";
        const player = new Player("Test", "1", { experience: 80 });
        const { progression, experienceAwarded } = player.addScavengeExperience(20);
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.mocked(scavengeForPlayer).mockResolvedValue({
            status: "found", key: "wild_berries", item: items.wild_berries, quantity: 2,
            odds: 123.4, experienceAwarded, progression, equippedTools: [],
            nextScavengeAt: new Date().toISOString(),
        });
        const deleted = vi.fn().mockResolvedValue(undefined);
        const deferReply = vi.fn().mockResolvedValue(undefined);
        const editReply = vi.fn().mockResolvedValue(undefined);
        const followUp = vi.fn().mockResolvedValue({ id: "level-up" });
        const interaction = {
            user: { id: "1", toString: () => "<@1>" }, client: {}, deferReply, editReply, followUp,
            webhook: { deleteMessage: deleted },
        } as unknown as ChatInputCommandInteraction;

        await command.execute(interaction);
        expect(deferReply).toHaveBeenCalledWith();
        const embed = editReply.mock.calls[0][0].embeds[0].toJSON();
        expect(embed.description).toContain("[Wild Berries](https://game.example/item?key=wild_berries) ×2");
        expect(embed.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "Chance", value: "Approximately 1/123 per search" }),
            expect.objectContaining({ name: "Experience earned", value: "20 XP" }),
        ]));
        const announcement = followUp.mock.calls[0][0];
        expect(announcement.components[0].toJSON().components[0].url).toBe("https://game.example/skills");
        await vi.advanceTimersByTimeAsync(29_999);
        expect(deleted).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(deleted).toHaveBeenCalledExactlyOnceWith("level-up");
        expect(editReply).toHaveBeenCalledOnce();
    });

    test("reports the remaining cooldown without awarding anything", async () => {
        vi.spyOn(Player, "get").mockResolvedValue(new Player("Test", "1"));
        vi.mocked(scavengeForPlayer).mockResolvedValue({ status: "cooldown", remainingMs: 61_000 });
        const editReply = vi.fn();
        const followUp = vi.fn();
        await command.execute({
            user: { id: "1" }, client: {}, deferReply: vi.fn(), editReply, followUp,
        } as unknown as ChatInputCommandInteraction);
        expect(editReply).toHaveBeenCalledWith(expect.stringContaining("1 minute and 1 second"));
        expect(followUp).not.toHaveBeenCalled();
    });

    test("omits the skill link when no skill points were earned", () => {
        const player = new Player("Test", "1");
        const progression = player.addExperience(1);
        expect(levelUpMessage("<@1>", progression).components).toHaveLength(0);
    });

    test("explains how to free space when the backpack is full", async () => {
        vi.spyOn(Player, "get").mockResolvedValue(new Player("Test", "1"));
        vi.mocked(scavengeForPlayer).mockResolvedValue({ status: "full", used: 12, capacity: 10 });
        const editReply = vi.fn();
        await command.execute({
            user: { id: "1" }, client: {}, deferReply: vi.fn(), editReply,
        } as unknown as ChatInputCommandInteraction);
        expect(editReply).toHaveBeenCalledWith(expect.stringContaining("12/10"));
        expect(editReply).toHaveBeenCalledWith(expect.stringContaining("/sell"));
    });
});
