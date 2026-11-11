import { afterEach, describe, expect, test, vi } from "vitest";
import type { ButtonInteraction, Message } from "discord.js";

vi.mock("../src/database.js", () => ({
    getPool: vi.fn(),
    getCache: vi.fn(),
}));
const diagnostics = vi.hoisted(() => ({ debugLog: vi.fn() }));
vi.mock("../src/debugSettings.js", () => diagnostics);
vi.mock("../src/lootboxStorage.js", () => ({
    getLootboxBonuses: vi.fn(async () => ({ lootboxDrop: 1, lootboxRarity: 1, lootboxReward: 1, lootboxFind: 1 })),
    savePlayerWithLootbox: vi.fn(async (player: Player) => player.save()),
}));
vi.mock("../src/resources/lootboxes.js", async importOriginal => ({
    ...await importOriginal<typeof import("../src/resources/lootboxes.js")>(),
    lootboxDropChance: vi.fn(() => 0),
}));

import Player, { PlayerConflictError } from "../src/classes/Player.js";
import messageEvent from "../src/bot/events/messageCreate.js";
import buttonEvent from "../src/bot/events/buttonInteraction.js";
import { PrestigeBuffs } from "../src/resources/prestigeBuffs.js";
import { getLootboxBonuses, savePlayerWithLootbox } from "../src/lootboxStorage.js";
import { lootboxDropChance } from "../src/resources/lootboxes.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    diagnostics.debugLog.mockClear();
});

describe("progression events", () => {
    test("awards and announces a message lootbox on the eligible roll", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        vi.mocked(lootboxDropChance).mockReturnValueOnce(1 / 500);
        vi.mocked(getLootboxBonuses).mockResolvedValueOnce({ lootboxDrop: 1, lootboxRarity: 1, lootboxReward: 1, lootboxFind: 1 });
        const player = new Player("Test", "box-message");
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.spyOn(player, "save").mockResolvedValue();
        const send = vi.fn();
        await messageEvent.execute({
            member: { id: player.id, user: { bot: false }, toString: () => "@test" },
            client: {}, channel: { send },
        } as unknown as Message);
        expect(savePlayerWithLootbox).toHaveBeenCalledWith(player, "Common");
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Common lootbox") }));
    });

    test("a roll at the 1/500 threshold does not award a box", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0.002);
        vi.mocked(lootboxDropChance).mockReturnValueOnce(1 / 500);
        const player = new Player("Test", "no-box-message");
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const save = vi.spyOn(player, "save").mockResolvedValue();
        const send = vi.fn();
        await messageEvent.execute({
            member: { id: player.id, user: { bot: false } }, client: {}, channel: { send },
        } as unknown as Message);
        expect(save).toHaveBeenCalledOnce();
        expect(send).not.toHaveBeenCalled();
        expect(savePlayerWithLootbox).not.toHaveBeenCalledWith(player, expect.anything());
    });

    test("logs the rounded money actually awarded", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const player = new Player("Test", "rounded-money", { equippedCompanion: "coinling" });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.spyOn(player, "save").mockResolvedValue();
        const message = {
            member: { id: "rounded-money", user: { bot: false } },
            channelId: "channel", client: {}, channel: { send: vi.fn() },
        } as unknown as Message;
        await messageEvent.execute(message);
        expect(player.balance).toBe(52);
        expect(diagnostics.debugLog).toHaveBeenCalledWith(
            "rewards", "channel", expect.stringContaining("15 XP, 52 money, 0 skill points"),
        );
    });

    test("retries a level-up after a concurrent skill purchase", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const stale = new Player("Test", "retry-level", { experience: 75 });
        const fresh = new Player("Test", "retry-level", {
            experience: 75, skills: ["skill_mastery_1"],
        });
        vi.spyOn(Player, "get").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
        vi.spyOn(stale, "save").mockRejectedValue(new PlayerConflictError());
        vi.spyOn(fresh, "save").mockResolvedValue();
        const send = vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) });
        const message = {
            member: { id: "retry-level", user: { bot: false }, toString: () => "@test" },
            client: {},
            channel: { send },
        } as unknown as Message;

        await messageEvent.execute(message);
        expect(fresh.level).toBe(2);
        expect(fresh.skillPoints).toBe(2);
        expect(fresh.save).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("earned 2 skill points"),
        }));
        const announcement = send.mock.calls[0][0];
        expect(announcement.components[0].toJSON().components[0].url).toMatch(/\/skills$/);
        const sentMessage = await send.mock.results[0].value;
        await vi.advanceTimersByTimeAsync(29_999);
        expect(sentMessage.delete).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(sentMessage.delete).toHaveBeenCalledOnce();
        expect(diagnostics.debugLog).toHaveBeenCalledWith("rewards", undefined,
            expect.stringContaining("15 XP, 50 money, 2 skill points"));
    });

    test("keeps the same jackpot roll on retry and announces only after saving", async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, "random")
            .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0)
            .mockReturnValue(0.99);
        const stale = new Player("Test", "retry-jackpot", { skills: ["jackpot"] });
        const fresh = new Player("Test", "retry-jackpot", { skills: ["jackpot"] });
        vi.spyOn(Player, "get").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
        vi.spyOn(stale, "save").mockRejectedValue(new PlayerConflictError());
        vi.spyOn(fresh, "save").mockResolvedValue();
        const send = vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) });
        const message = {
            member: { id: "retry-jackpot", user: { bot: false }, toString: () => "@test" },
            client: {}, channel: { send },
        } as unknown as Message;

        await messageEvent.execute(message);
        expect(random).toHaveBeenCalledTimes(4);
        expect(fresh.balance).toBe(5075);
        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("Jackpot! You found $5,025"),
        }));
    });

    test("reuses Momentum's roll on retry with the refreshed level requirement", async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, "random").mockReturnValue(0);
        const stale = new Player("Test", "retry-momentum", { level: 2, skills: ["momentum"] });
        const fresh = new Player("Test", "retry-momentum", { level: 5, skills: ["momentum"] });
        vi.spyOn(Player, "get").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
        vi.spyOn(stale, "save").mockRejectedValue(new PlayerConflictError());
        vi.spyOn(fresh, "save").mockResolvedValue();
        const message = {
            member: { id: "retry-momentum", user: { bot: false }, toString: () => "@test" },
            client: {}, channel: { send: vi.fn() },
        } as unknown as Message;

        await messageEvent.execute(message);
        expect(random).toHaveBeenCalledTimes(4);
        expect(fresh.experience).toBe(15 + Math.floor(fresh.xpForNextLevel(5) * 0.01));
        expect(fresh.save).toHaveBeenCalledOnce();
    });

    test("does not announce a jackpot when saving fails", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const player = new Player("Test", "failed-jackpot", { skills: ["jackpot"] });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.spyOn(player, "save").mockRejectedValue(new Error("Database unavailable"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const send = vi.fn();
        const message = {
            member: { id: "failed-jackpot", user: { bot: false } }, client: {}, channel: { send },
        } as unknown as Message;
        await messageEvent.execute(message);
        expect(send).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
    });

    test("special skills only roll for rewarded messages outside the cooldown", async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, "random").mockReturnValue(0);
        const player = new Player("Test", "cooldown-test", { skills: ["jackpot"] });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const save = vi.spyOn(player, "save").mockResolvedValue();
        const send = vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) });
        const message = {
            member: { id: "cooldown-test", user: { bot: false }, toString: () => "@test" },
            client: {}, channel: { send },
        } as unknown as Message;
        await messageEvent.execute(message);
        await messageEvent.execute(message);
        expect(save).toHaveBeenCalledTimes(1);
        expect(random).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(30000);
        await messageEvent.execute(message);
        expect(save).toHaveBeenCalledTimes(2);
        expect(random).toHaveBeenCalledTimes(8);
    });

    test("prestige retries with current skills and resets them before confirming", async () => {
        const buff = PrestigeBuffs[0];
        const stale = new Player("Test", "prestige", {
            level: 10, skills: ["extra_income"], skillPoints: 2,
            temp: { prestigeBuffs: [buff] },
        });
        const fresh = new Player("Test", "prestige", {
            level: 10, skills: ["extra_income", "skill_mastery_1"], skillPoints: 1,
            temp: { prestigeBuffs: [buff] },
        });
        vi.spyOn(Player, "get").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
        vi.spyOn(stale, "save").mockRejectedValue(new PlayerConflictError());
        vi.spyOn(fresh, "save").mockResolvedValue();
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            user: { id: "prestige", bot: false }, client: {},
            customId: `prestige_buff_${buff.id}`,
            component: { label: buff.name }, reply,
        } as unknown as ButtonInteraction;

        await buttonEvent.execute(interaction);
        expect(fresh.toJSON()).toMatchObject({ level: 1, prestige: 1, skillPoints: 0, skills: [] });
        expect(fresh.save).toHaveBeenCalledOnce();
        expect(savePlayerWithLootbox).toHaveBeenCalledWith(fresh, expect.any(String));
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("skills, and skill points have been reset"),
        }));
    });

    test("a stale prestige button cannot reset the tree a second time", async () => {
        const player = new Player("Test", "prestige", { level: 1, skills: ["extra_income"], skillPoints: 4 });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const save = vi.spyOn(player, "save");
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
            user: { id: "prestige", bot: false }, client: {},
            customId: "prestige_buff_1", reply,
        } as unknown as ButtonInteraction;

        await buttonEvent.execute(interaction);
        expect(save).not.toHaveBeenCalled();
        expect(player.skills).toEqual(["extra_income"]);
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("no longer available"),
        }));
    });

    test("starting skill point buff is awarded after the reset and saved", async () => {
        const buff = PrestigeBuffs.find(item => item.id === 27)!;
        const player = new Player("Test", "prestige-start", {
            level: 10, skills: ["extra_income"], skillPoints: 12, temp: { prestigeBuffs: [buff] },
        });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const save = vi.spyOn(player, "save").mockResolvedValue();
        const reply = vi.fn().mockResolvedValue(undefined);
        await buttonEvent.execute({
            user: { id: player.id, bot: false }, client: {},
            customId: `prestige_buff_${buff.id}`, component: { label: buff.name }, reply,
        } as unknown as ButtonInteraction);
        expect(player.skills).toEqual([]);
        expect(player.skillPoints).toBe(3);
        expect(player.prestigeLevel).toBe(1);
        expect(save).toHaveBeenCalledOnce();
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(buff.description) }));
    });

    test("prestige reports companions unequipped after losing the skill slot", async () => {
        const buff = PrestigeBuffs[0];
        const player = new Player("Test", "prestige-slots", {
            level: 10, skills: ["companion_bond"], equippedCompanions: ["mossprout", "coinling"],
            temp: { prestigeBuffs: [buff] },
        });
        vi.spyOn(Player, "get").mockResolvedValue(player);
        vi.spyOn(player, "save").mockResolvedValue();
        const reply = vi.fn();
        await buttonEvent.execute({
            user: { id: player.id, bot: false }, client: {},
            customId: `prestige_buff_${buff.id}`, component: { label: buff.name }, reply,
        } as unknown as ButtonInteraction);
        expect(player.equippedCompanions).toEqual(["mossprout"]);
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("Unequipped due to lost slots: Coinling."),
        }));
    });
});
