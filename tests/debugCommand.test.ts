import { beforeEach, describe, expect, test, vi } from "vitest";
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

const mocks = vi.hoisted(() => ({ set: vi.fn(), enabled: vi.fn() }));
vi.mock("../src/debugSettings.js", () => ({ setDebugSetting: mocks.set, isDebugEnabled: mocks.enabled }));
import command from "../src/bot/commands/debug.js";

function interaction(user: string, owner: object, topic = "chance", action = "on") {
    const deferReply = vi.fn(), editReply = vi.fn();
    return {
        user: { id: user }, channelId: "123", deferReply, editReply,
        client: { application: { fetch: async () => ({ owner }) } },
        options: { getString: (name: string) => name === "topic" ? topic : action },
    } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
    mocks.set.mockReset();
    mocks.enabled.mockReset().mockResolvedValue(true);
});

describe("private debug command", () => {
    test("is registered for guild administrators", () => {
        expect(command.data.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
        expect(command.data.contexts).toEqual([0]);
    });

    test("rejects administrators who are not the application owner", async () => {
        const request = interaction("other", { id: "owner" });
        await command.execute(request);
        expect(request.deferReply).toHaveBeenCalledWith({ flags: [MessageFlags.Ephemeral] });
        expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining("Only the bot application owner"));
        expect(mocks.set).not.toHaveBeenCalled();
    });

    test("supports channel and global scopes and status without changing settings", async () => {
        const chance = interaction("owner", { ownerId: "owner" });
        await command.execute(chance);
        expect(mocks.set).toHaveBeenCalledWith("chance", "123", true);
        expect(mocks.enabled).toHaveBeenCalledWith("chance", "123");
        const rewards = interaction("owner", { id: "owner" }, "rewards", "off");
        await command.execute(rewards);
        expect(mocks.set).toHaveBeenCalledWith("rewards", "123", false);
        const gambling = interaction("owner", { id: "owner" }, "gambling", "status");
        await command.execute(gambling);
        expect(mocks.enabled).toHaveBeenCalledWith("gambling", "global");
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    test("reports database failures privately", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.set.mockRejectedValueOnce(new Error("unavailable"));
        const request = interaction("owner", { id: "owner" });
        await command.execute(request);
        expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining("Could not configure"));
        vi.restoreAllMocks();
    });
});
