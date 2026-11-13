import { beforeEach, describe, expect, test, vi } from "vitest";
import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

const mocks = vi.hoisted(() => ({ set: vi.fn(), enabled: vi.fn() }));
vi.mock("../src/debugSettings.js", () => ({
    setDebugSetting: mocks.set, isDebugEnabled: mocks.enabled, debugTopics: ["chance", "rewards", "gambling", "lootboxes"],
}));
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
        expect(command.data.options?.[0].choices).toContainEqual({ name: "Lootbox chances and rewards (global)", value: "lootboxes" });
    });

    test("rejects administrators who are not the application owner", async () => {
        const request = interaction("other", { id: "owner" });
        await command.execute(request);
        expect(request.deferReply).toHaveBeenCalledWith({ flags: [MessageFlags.Ephemeral] });
        expect(request.editReply).toHaveBeenCalledWith(expect.stringContaining("Only the bot application owner"));
        expect(mocks.set).not.toHaveBeenCalled();
    });

    test("uses global settings for all topics and status does not change settings", async () => {
        const chance = interaction("owner", { ownerId: "owner" });
        await command.execute(chance);
        expect(mocks.set).toHaveBeenCalledWith("chance", true);
        expect(mocks.enabled).toHaveBeenCalledWith("chance");
        const rewards = interaction("owner", { id: "owner" }, "rewards", "off");
        await command.execute(rewards);
        expect(mocks.set).toHaveBeenCalledWith("rewards", false);
        const gambling = interaction("owner", { id: "owner" }, "gambling", "status");
        await command.execute(gambling);
        expect(mocks.enabled).toHaveBeenCalledWith("gambling");
        expect(mocks.set).toHaveBeenCalledTimes(2);
        const lootboxes = interaction("owner", { id: "owner" }, "lootboxes", "on");
        await command.execute(lootboxes);
        expect(mocks.set).toHaveBeenCalledWith("lootboxes", true);
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
