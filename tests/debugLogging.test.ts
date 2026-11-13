import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(), lPush: vi.fn(), lTrim: vi.fn(), exec: vi.fn(), lRange: vi.fn(),
}));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => ({
        lRange: mocks.lRange,
        multi: () => ({ lPush: mocks.lPush, lTrim: mocks.lTrim, exec: mocks.exec }),
    }),
}));
vi.mock("../src/auth.js", () => ({ loadSession: vi.fn() }));
vi.mock("../src/api/lobbies.js", () => ({ default: vi.fn() }));

import { debugLog, getDebugLogs, isDebugEnabled, setDebugSetting } from "../src/debugSettings.js";
import { recordBets } from "../src/api/casino.js";

beforeEach(() => {
    mocks.query.mockReset();
    mocks.lPush.mockReset();
    mocks.lTrim.mockReset();
    mocks.exec.mockReset().mockResolvedValue([]);
    mocks.lRange.mockReset();
    const transaction = { lPush: mocks.lPush, lTrim: mocks.lTrim, exec: mocks.exec };
    mocks.lPush.mockReturnValue(transaction);
    mocks.lTrim.mockReturnValue(transaction);
    vi.restoreAllMocks();
});

describe("debug logging", () => {
    test("uses one global setting per topic", async () => {
        mocks.query.mockResolvedValue({ rowCount: 1 });
        await setDebugSetting("chance", true);
        await setDebugSetting("gambling", false);
        expect(await isDebugEnabled("rewards")).toBe(true);
        expect(mocks.query.mock.calls.map(call => call[1])).toEqual([
            ["chance", "global"], ["gambling", "global"], ["rewards", "global"],
        ]);
    });

    test("stores enabled logs with context and bounds the shared list", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        mocks.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
        debugLog("chance", "channel", "one", { username: "Alice", guild: "Guild", channel: "general" });
        debugLog("chance", "other-channel", "two");
        await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledOnce());
        expect(log).toHaveBeenCalledOnce();
        const entry = JSON.parse(mocks.lPush.mock.calls[0][1]);
        expect(entry).toMatchObject({ topic: "chance", message: "one", username: "Alice", guild: "Guild", channel: "general" });
        expect(mocks.lTrim).toHaveBeenCalledWith("developer:debug-logs", 0, 499);
        mocks.lRange.mockResolvedValue([JSON.stringify(entry)]);
        expect(await getDebugLogs()).toEqual([entry]);
    });

    test("reports storage and settings failures explicitly", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        mocks.query.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ rowCount: 1 });
        mocks.exec.mockRejectedValueOnce(new Error("redis offline"));
        debugLog("chance", "channel", "one");
        debugLog("chance", "channel", "two");
        await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    });

    test("logs settled gambling totals independently of recording failures", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        mocks.query.mockResolvedValueOnce({ rowCount: 1 }).mockRejectedValueOnce(new Error("write failed"));
        await recordBets("player", "plinko", [{ bet: 10, payout: 15 }, { bet: 10, payout: 0 }], "Alice");
        await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledOnce());
        expect(JSON.parse(mocks.lPush.mock.calls[0][1])).toMatchObject({
            username: "Alice", userId: "player", guild: "Website", channel: "Casino",
            message: "Player player, plinko: 2 round(s), wager 20, payout 15",
        });
        expect(error).toHaveBeenCalledWith("Failed to record casino bets:", expect.any(Error));
    });
});
