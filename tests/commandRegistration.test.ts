import { readdirSync } from "node:fs";
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import { describe, expect, test, vi } from "vitest";
import type { Command } from "../src/classes/Command.js";
import { isGuildOnlyCommand, publicCommandData } from "../src/bot/commandRegistration.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));

describe("command registration", () => {
    test("registers every public command for server and user installs in all supported contexts", async () => {
        const files = readdirSync("src/bot/commands").filter(file => file.endsWith(".ts"));
        const commands = await Promise.all(files.map(async file => {
            const name = file.slice(0, -3);
            const module = await import(`../src/bot/commands/${name}.ts`);
            return module.default as Command;
        }));
        const publicCommands = commands.filter(command => !isGuildOnlyCommand(command.data));
        expect(commands.filter(command => isGuildOnlyCommand(command.data)).map(command => command.data.name)).toEqual(["debug"]);
        expect(publicCommands.map(command => command.data.name)).toContain("scavenge");
        for (const command of publicCommands) {
            const registered = publicCommandData(command.data);
            expect(registered.integration_types).toEqual([
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall,
            ]);
            expect(registered.contexts).toEqual([
                InteractionContextType.Guild,
                InteractionContextType.BotDM,
                InteractionContextType.PrivateChannel,
            ]);
            expect(registered.name).toBe(command.data.name);
            expect(registered.options).toEqual(command.data.options);
        }
        const debug = commands.find(command => command.data.name === "debug");
        expect(debug?.devMode).toBe(true);
        expect(debug?.data.contexts).toEqual([InteractionContextType.Guild]);
    });

    test("new commands default to user installation unless named debug", () => {
        expect(isGuildOnlyCommand({ name: "future-command", description: "Future command" })).toBe(false);
        expect(publicCommandData({ name: "future-command", description: "Future command" }).integration_types)
            .toContain(ApplicationIntegrationType.UserInstall);
        expect(isGuildOnlyCommand({ name: "debug", description: "Debug" })).toBe(true);
    });
});
