import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), log: vi.fn() }));
vi.mock("../src/database.js", () => ({ getPool: () => ({ query: mocks.query }), getCache: vi.fn() }));
vi.mock("../src/auth.js", () => ({ loadSession: vi.fn() }));
vi.mock("../src/api/lobbies.js", () => ({ default: vi.fn() }));

import { debugLog, isDebugEnabled, setDebugSetting } from "../src/debugSettings.js";
import { recordBets } from "../src/api/casino.js";

beforeEach(() => {
    mocks.query.mockReset();
    vi.restoreAllMocks();
});

describe("debug logging", () => {
    test("queries persisted settings and reports failures without throwing", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 })
            .mockRejectedValueOnce(new Error("offline"));
        debugLog("chance", "channel", "one");
        debugLog("chance", "channel", "two");
        debugLog("chance", "channel", "three");
        await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
        expect(log).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith("[debug:chance] one");
    });

    test("stores independent scopes and checks the database each time", async () => {
        mocks.query.mockResolvedValue({ rowCount: 1 });
        await setDebugSetting("chance", "channel", true);
        await setDebugSetting("gambling", "global", false);
        expect(await isDebugEnabled("rewards", "channel")).toBe(true);
        expect(mocks.query.mock.calls.map(call => call[1])).toEqual([
            ["chance", "channel"], ["gambling", "global"], ["rewards", "channel"],
        ]);
    });

    test("logs settled gambling totals independently of recording failures", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.query.mockResolvedValueOnce({ rowCount: 1 }).mockRejectedValueOnce(new Error("write failed"));
        await recordBets("player", "plinko", [{ bet: 10, payout: 15 }, { bet: 10, payout: 0 }]);
        await vi.waitFor(() => expect(log).toHaveBeenCalledWith("[debug:gambling] Player player, plinko: 2 round(s), wager 20, payout 15"));
        expect(error).toHaveBeenCalledWith("Failed to record casino bets:", expect.any(Error));
    });
});
