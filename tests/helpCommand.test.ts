import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import command from "../src/bot/commands/help.js";

afterEach(() => {
    delete process.env.WEBSITE_URL;
    delete process.env.DISCORD_REDIRECT_URI;
    vi.restoreAllMocks();
});

describe("help command", () => {
    test("shows basic guidance and links to the configured wiki", async () => {
        process.env.WEBSITE_URL = "https://game.example/";
        const reply = vi.fn();
        await command.execute({ reply } as unknown as ChatInputCommandInteraction);

        const embed = reply.mock.calls[0][0].embeds[0];
        expect(embed.data.description).toContain("[Open the full game guide](https://game.example/wiki)");
        expect(embed.data.fields.map((field: { name: string }) => field.name)).toEqual([
            "Progression",
            "Companions",
        ]);
    });

    test("falls back to the Discord redirect URI origin", async () => {
        process.env.DISCORD_REDIRECT_URI = "https://game.example/auth/callback";
        const reply = vi.fn();
        await command.execute({ reply } as unknown as ChatInputCommandInteraction);

        expect(reply.mock.calls[0][0].embeds[0].data.description)
            .toContain("[Open the full game guide](https://game.example/wiki)");
    });
});
