import { afterEach, describe, expect, test, vi } from "vitest";
import type { ButtonInteraction, Message } from "discord.js";

const mocks = vi.hoisted(() => ({
    circulation: vi.fn(), findById: vi.fn(), create: vi.fn(), setMessage: vi.fn(),
    cancel: vi.fn(), expire: vi.fn(), open: vi.fn(), catch: vi.fn(), debugLog: vi.fn(),
    ...(() => {
        const channelStates = new Map<string, { chance: number; lastUserId: string }>();
        return {
            channelStates,
            getChannelState: vi.fn(async (channelId: string) => channelStates.get(channelId) ?? null),
            saveChannelState: vi.fn(async (channelId: string, state: { chance: number; lastUserId: string }) => {
                channelStates.set(channelId, { ...state });
            }),
        };
    })(),
}));
vi.mock("../src/debugSettings.js", () => ({ debugLog: mocks.debugLog }));
vi.mock("../src/classes/Player.js", () => ({ default: { findById: mocks.findById } }));
vi.mock("../src/companionStorage.js", () => ({
    getCompanionCirculation: mocks.circulation,
    createCompanionEncounter: mocks.create,
    setEncounterMessage: mocks.setMessage,
    cancelCompanionEncounter: mocks.cancel,
    expireCompanionEncounter: mocks.expire,
    getOpenCompanionEncounters: mocks.open,
    catchCompanionEncounter: mocks.catch,
    getCompanionChannelState: mocks.getChannelState,
    saveCompanionChannelState: mocks.saveChannelState,
}));

import { chooseCompanion, handleCatchButton, handleEncounterMessage, restoreCompanionEncounters } from "../src/bot/companionEncounters.js";
import { companionEncounterWeight, companions } from "../src/resources/companions.js";
import { companionSkillMultiplier, SkillEffect } from "../src/resources/skills.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mocks.debugLog.mockClear();
    mocks.findById.mockReset();
    mocks.getChannelState.mockClear();
    mocks.saveChannelState.mockClear();
    mocks.channelStates.clear();
});

describe("companion encounters", () => {
    test("selection uses rarity, circulation and the triggering player's companion bonus", () => {
        const catalog = Object.entries(companions);
        const weights = catalog.map(([key, companion]) =>
            companionEncounterWeight(companion, companions.glimmerfox) / (key === "mossprout" ? 2 : 1));
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let lower = 0;
        for (let i = 0; i < catalog.length; i++) {
            const midpoint = (lower + weights[i] / 2) / total;
            expect(chooseCompanion([{ key: "mossprout", quantity: "100" }], companions.glimmerfox, midpoint))
                .toBe(catalog[i][0]);
            lower += weights[i];
        }
    });

    test("companion skill multipliers stack only for their own effect", () => {
        const keys = ["field_notes", "lucky_trails", "keen_senses", "rare_insight", "experience_gain_1", "unknown"];
        expect(companionSkillMultiplier(keys, SkillEffect.CompanionSpawn)).toBeCloseTo(1.5);
        expect(companionSkillMultiplier(keys, SkillEffect.CompanionRarity)).toBeCloseTo(1.5);
        expect(companionSkillMultiplier([], SkillEffect.CompanionRarity)).toBe(1);
    });

    test("sender bonuses modify only that roll and preserve the shared channel counter", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        mocks.findById.mockImplementation(async (id: string) =>
            id === "skilled" ? { skills: ["field_notes", "lucky_trails"] } : null);
        const message = (id: string) => ({
            guild: {}, channelId: "channel-skill-ownership", author: { id, bot: false },
        }) as unknown as Message;
        await handleEncounterMessage(message("skilled"));
        await handleEncounterMessage(message("skilled"));
        await handleEncounterMessage(message("unskilled"));
        await handleEncounterMessage(message("skilled"));
        expect(mocks.findById).toHaveBeenCalledTimes(3);
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-skill-ownership: 1.5/1000",
            "Channel channel-skill-ownership: 7/1000",
            "Channel channel-skill-ownership: 19.5/1000",
        ]);
    });

    test("a spawn selects using the sender's rarity skills and equipped companion", async () => {
        vi.useFakeTimers();
        const circulation = [{ key: "mossprout", quantity: "100" }];
        const roll = Array.from({ length: 10_000 }, (_, i) => (i + 0.5) / 10_000)
            .find(value => chooseCompanion(circulation, companions.glimmerfox, value, 1.5 * 1.1)
                !== chooseCompanion(circulation, companions.glimmerfox, value, 1.5));
        if (roll === undefined) throw new Error("No distinguishing selection roll found");
        const expected = chooseCompanion(circulation, companions.glimmerfox, roll, 1.5 * 1.1);
        vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(roll);
        mocks.findById.mockResolvedValue({
            skills: ["keen_senses", "rare_insight"], equippedCompanions: ["glimmerfox"],
            prestigeCompanionRarityMultiplier: 1.1,
        });
        mocks.circulation.mockResolvedValue(circulation);
        mocks.create.mockResolvedValue({});
        mocks.setMessage.mockImplementation(async (id: string) => ({
            id, channel_id: "channel-rarity", message_id: "message", companion_key: expected,
            expires_at: new Date(Date.now() + 30_000),
        }));
        const send = vi.fn().mockResolvedValue({ id: "message", edit: vi.fn() });
        await handleEncounterMessage({
            guild: {}, channelId: "channel-rarity", author: { id: "skilled", bot: false },
            client: {}, channel: { isSendable: () => true, send },
        } as unknown as Message);
        expect(mocks.create).toHaveBeenLastCalledWith(expect.any(String), "channel-rarity", expected);
        expect(send).toHaveBeenCalledWith({ content: expect.stringContaining(companions[expected].name) });
    });

    test("a spawn applies every equipped rarity companion's bonus", async () => {
        vi.useFakeTimers();
        const equipped = [companions.glimmerfox, companions.prismoth];
        const roll = Array.from({ length: 10_000 }, (_, i) => (i + 0.5) / 10_000)
            .find(value => chooseCompanion([], equipped, value) !== chooseCompanion([], equipped[0], value));
        if (roll === undefined) throw new Error("No distinguishing selection roll found");
        const expected = chooseCompanion([], equipped, roll);
        vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(roll);
        mocks.findById.mockResolvedValue({
            skills: [], equippedCompanions: ["glimmerfox", "prismoth"],
        });
        mocks.circulation.mockResolvedValue([]);
        mocks.create.mockResolvedValue({});
        mocks.setMessage.mockImplementation(async (id: string) => ({
            id, channel_id: "channel-multiple-rarity", message_id: "message", companion_key: expected,
            expires_at: new Date(Date.now() + 30_000),
        }));
        const send = vi.fn().mockResolvedValue({ id: "message", edit: vi.fn() });
        await handleEncounterMessage({
            guild: {}, channelId: "channel-multiple-rarity", author: { id: "skilled", bot: false },
            client: {}, channel: { isSendable: () => true, send },
        } as unknown as Message);
        expect(mocks.create).toHaveBeenLastCalledWith(expect.any(String), "channel-multiple-rarity", expected);
    });

    test("appearance skills change the actual roll threshold, not just its display", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random")
            .mockReturnValueOnce(0.00125).mockReturnValueOnce(0)
            .mockReturnValueOnce(0.00125).mockReturnValueOnce(0);
        mocks.findById.mockImplementation(async (id: string) =>
            id === "skilled" ? { skills: ["field_notes", "lucky_trails"] } : null);
        mocks.circulation.mockResolvedValue([]);
        mocks.create.mockResolvedValue({});
        mocks.setMessage.mockImplementation(async (id: string) => ({
            id, channel_id: "channel-boosted-threshold", message_id: "message", companion_key: "mossprout",
            expires_at: new Date(Date.now() + 30_000),
        }));
        const send = vi.fn().mockResolvedValue({ id: "message", edit: vi.fn() });
        const message = (id: string, channelId: string) => ({
            guild: {}, channelId, author: { id, bot: false },
            client: {}, channel: { isSendable: () => true, send },
        }) as unknown as Message;
        await handleEncounterMessage(message("unskilled", "channel-baseline-threshold"));
        expect(send).not.toHaveBeenCalled();
        await handleEncounterMessage(message("skilled", "channel-boosted-threshold"));
        expect(send).toHaveBeenCalledTimes(1);
    });

    test("prestige appearance bonus stacks with skills for the eligible sender only", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        mocks.findById.mockImplementation(async (id: string) => id === "boosted"
            ? { skills: ["field_notes"], prestigeCompanionSpawnMultiplier: 1.1 } : null);
        const message = (id: string) => ({
            guild: {}, channelId: "channel-prestige-bonus", author: { id, bot: false },
        }) as unknown as Message;
        await handleEncounterMessage(message("boosted"));
        await handleEncounterMessage(message("other"));
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-prestige-bonus: 1.375/1000",
            "Channel channel-prestige-bonus: 7/1000",
        ]);
    });

    test("eligible messages retain their order while player lookups are pending, even after an error", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        mocks.findById.mockImplementation(async (id: string) => {
            if (id === "first") await pending;
            if (id === "second") throw new Error("lookup failed");
            return null;
        });
        const message = (id: string) => ({
            guild: {}, channelId: "channel-skill-queue", author: { id, bot: false },
        }) as unknown as Message;
        const first = handleEncounterMessage(message("first"));
        const second = handleEncounterMessage(message("second"));
        const failure = expect(second).rejects.toThrow("lookup failed");
        const third = handleEncounterMessage(message("third"));
        await vi.waitFor(() =>
            expect(mocks.findById.mock.calls.map(call => call[0])).toEqual(["first"]),
        );
        release();
        await Promise.all([first, failure, third]);
        expect(mocks.findById.mock.calls.map(call => call[0])).toEqual(["first", "second", "third"]);
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-skill-queue: 1/1000",
            "Channel channel-skill-queue: 7/1000",
        ]);
    });

    test("a boosted appearance chance is capped at certainty", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.99999);
        mocks.findById.mockImplementation(async (id: string) =>
            id === "boosted" ? { skills: ["field_notes", "lucky_trails"] } : null);
        mocks.circulation.mockResolvedValue([]);
        mocks.create.mockResolvedValue({});
        mocks.setMessage.mockImplementation(async (id: string) => ({
            id, channel_id: "channel-cap", message_id: "message", companion_key: "mossprout",
            expires_at: new Date(Date.now() + 30_000),
        }));
        const send = vi.fn().mockResolvedValue({ id: "message", edit: vi.fn() });
        const message = (id: string) => ({
            guild: {}, channelId: "channel-cap", author: { id, bot: false },
            client: {}, channel: { isSendable: () => true, send },
        }) as unknown as Message;
        for (let i = 0; i < 67; i++) await handleEncounterMessage(message(i % 2 ? "a" : "b"));
        await handleEncounterMessage(message("boosted"));
        expect(mocks.debugLog.mock.calls.at(-1)?.[2]).toBe("Channel channel-cap: 1000/1000");
        expect(send).toHaveBeenCalledTimes(1);
        await handleEncounterMessage(message("a"));
        expect(mocks.debugLog.mock.calls.at(-1)?.[2]).toBe("Channel channel-cap: 1/1000");
    });

    test("only alternating users roll and chance persists beyond 30 minutes of inactivity", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const random = vi.spyOn(Math, "random")
            .mockReturnValueOnce(0.5).mockReturnValueOnce(0)
            .mockReturnValueOnce(0.5).mockReturnValueOnce(0.999)
            .mockReturnValueOnce(0.5).mockReturnValueOnce(0);
        const message = {
            guild: {}, channelId: "channel-chance", author: { id: "owner", bot: false },
            content: "hello",
        } as unknown as Message;
        await handleEncounterMessage(message);
        vi.advanceTimersByTime(29 * 60 * 1000);
        await handleEncounterMessage(message);
        expect(random).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(60 * 1000);
        await handleEncounterMessage(message);
        expect(random).toHaveBeenCalledTimes(2);
        Object.assign(message, { author: { id: "other", bot: false } });
        await handleEncounterMessage(message);
        Object.assign(message, { author: { id: "owner", bot: false } });
        await handleEncounterMessage(message);
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-chance: 1/1000",
            "Channel channel-chance: 2/1000",
            "Channel channel-chance: 12/1000",
        ]);
        expect(random).toHaveBeenCalledTimes(6);
    });

    test("restores the channel chance and previous sender from persistent state", async () => {
        mocks.channelStates.set("channel-restored", { chance: 37, lastUserId: "previous-sender" });
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const message = {
            guild: {}, channelId: "channel-restored", author: { id: "next-sender", bot: false },
        } as unknown as Message;

        await handleEncounterMessage(message);

        expect(mocks.debugLog).toHaveBeenCalledWith(
            "chance",
            "channel-restored",
            "Channel channel-restored: 37/1000",
        );
        expect(mocks.channelStates.get("channel-restored")).toEqual({
            chance: 43,
            lastUserId: "next-sender",
        });
    });

    test("chance survives prolonged inactivity and still requires another user", async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
        const message = {
            guild: {}, channelId: "channel-activity", author: { id: "owner", bot: false },
            content: "hello",
        } as unknown as Message;
        await handleEncounterMessage(message);
        vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
        Object.assign(message, { author: { id: "other", bot: false } });
        await handleEncounterMessage(message);
        Object.assign(message, { author: { id: "owner", bot: false } });
        await handleEncounterMessage(message);
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-activity: 1/1000",
            "Channel channel-activity: 7/1000",
            "Channel channel-activity: 13/1000",
        ]);
        expect(random).toHaveBeenCalledTimes(6);
    });

    test("eligibility is tracked separately for each channel", async () => {
        const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
        const message = {
            guild: {}, channelId: "channel-one", author: { id: "same-user", bot: false },
            content: "hello",
        } as unknown as Message;
        await handleEncounterMessage(message);
        await handleEncounterMessage(message);
        Object.assign(message, { channelId: "channel-two" });
        await handleEncounterMessage(message);
        expect(random).toHaveBeenCalledTimes(4);
    });

    test("a successful roll publishes a catch button and resets the channel chance", async () => {
        vi.useFakeTimers();
        const now = new Date("2026-01-01T00:00:00Z");
        vi.setSystemTime(now);
        vi.spyOn(Math, "random")
            .mockReturnValueOnce(0.5).mockReturnValueOnce(0.9)
            .mockReturnValueOnce(0).mockReturnValueOnce(0)
            .mockReturnValueOnce(0.5).mockReturnValueOnce(0);
        mocks.circulation.mockResolvedValue([]);
        mocks.findById.mockResolvedValue(null);
        mocks.create.mockResolvedValue({});
        mocks.setMessage.mockImplementation(async (id: string) => ({
            id, channel_id: "channel-spawn", message_id: "message",
            companion_key: "mossprout", expires_at: new Date(now.getTime() + 30_000),
        }));
        const edit = vi.fn();
        const send = vi.fn().mockResolvedValue({ id: "message", edit });
        const message = {
            guild: {}, channelId: "channel-spawn", author: { id: "owner", bot: false },
            content: "hello", reply: vi.fn(), client: {},
            channel: { isSendable: () => true, send },
        } as unknown as Message;
        await handleEncounterMessage(message);
        Object.assign(message, { author: { id: "other", bot: false } });
        await handleEncounterMessage(message);
        expect(send).toHaveBeenCalledWith({ content: expect.stringContaining("Mossprout") });
        const payload = edit.mock.calls[0][0];
        expect(payload.content).toContain("within 30 seconds");
        expect(payload.components[0].components[0].data.custom_id).toMatch(/^companion_catch:/);
        await handleEncounterMessage(message);
        expect(mocks.debugLog).toHaveBeenCalledTimes(2);
        Object.assign(message, { author: { id: "owner", bot: false } });
        await handleEncounterMessage(message);
        expect(mocks.debugLog.mock.calls.map(call => call[2])).toEqual([
            "Channel channel-spawn: 1/1000",
            "Channel channel-spawn: 11/1000",
            "Channel channel-spawn: 1/1000",
        ]);
    });

    test("first interaction is queued before waiting for acknowledgement", async () => {
        let acknowledge!: () => void;
        const delayed = new Promise<void>(resolve => { acknowledge = resolve; });
        mocks.catch.mockReset().mockResolvedValueOnce("mossprout").mockResolvedValueOnce(null);
        const editMessage = vi.fn();
        const firstReply = vi.fn();
        const secondReply = vi.fn();
        const base = {
            customId: "companion_catch:b9c9b0a7-2342-4c8f-a016-000000000001",
            channelId: "channel", message: { id: "message", edit: editMessage },
        };
        const first = { ...base, user: { id: "first", username: "First" }, deferReply: () => delayed, editReply: firstReply } as unknown as ButtonInteraction;
        const second = { ...base, user: { id: "second", username: "Second" }, deferReply: async () => {}, editReply: secondReply } as unknown as ButtonInteraction;
        const requests = [handleCatchButton(first), handleCatchButton(second)];
        acknowledge();
        await Promise.all(requests);
        expect(mocks.catch.mock.calls.map(call => call[3])).toEqual(["first", "second"]);
        expect(firstReply).toHaveBeenCalledWith("You caught Mossprout!");
        expect(secondReply).toHaveBeenCalledWith(expect.stringContaining("already been caught"));
    });

    test("restores outstanding encounters and removes expired buttons", async () => {
        vi.useFakeTimers();
        const now = new Date("2026-01-01T00:00:00Z");
        vi.setSystemTime(now);
        mocks.open.mockResolvedValue([{ id: "id", channel_id: "channel", message_id: "message", companion_key: "mossprout", expires_at: new Date(now.getTime() + 1000) }]);
        mocks.expire.mockResolvedValue(true);
        const edit = vi.fn();
        const client = { channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => ({ edit }) } }) } };
        await restoreCompanionEncounters(client as never);
        await vi.advanceTimersByTimeAsync(1100);
        expect(edit).toHaveBeenCalledWith({ content: "Mossprout escaped!", components: [] });
    });
});
