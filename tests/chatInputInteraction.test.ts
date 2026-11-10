import { beforeEach, describe, expect, test, vi } from "vitest";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

const mocks = vi.hoisted(() => ({ commands: new Map<string, { execute: ReturnType<typeof vi.fn> }>() }));
vi.mock("../src/index.js", () => ({ commands: mocks.commands }));
import event from "../src/bot/events/chatInputInteractionCreate.js";

beforeEach(() => {
    mocks.commands.clear();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("chat input command dispatch", () => {
    test("notifies the user when a command handler is missing", async () => {
        const reply = vi.fn();
        const interaction = { commandName: "companion", user: { bot: false }, reply } as unknown as ChatInputCommandInteraction;
        await event.execute(interaction);
        expect(reply).toHaveBeenCalledWith({
            content: expect.stringContaining("not available"),
            flags: [MessageFlags.Ephemeral],
        });
    });

    test("reports a command failure after it was deferred", async () => {
        mocks.commands.set("companion", { execute: vi.fn().mockRejectedValue(new Error("failure")) });
        const editReply = vi.fn();
        const interaction = {
            commandName: "companion", user: { bot: false, tag: "test" },
            deferred: true, replied: false, editReply,
        } as unknown as ChatInputCommandInteraction;
        await event.execute(interaction);
        expect(editReply).toHaveBeenCalledWith({ content: "The command failed. Please try again." });
    });
});
