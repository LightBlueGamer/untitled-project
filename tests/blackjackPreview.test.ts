import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    session: null as { id: string; username: string } | null,
    cache: new Map<string, string>(),
    random: vi.fn(),
    query: vi.fn(),
    findById: vi.fn(),
    invalidate: vi.fn(),
    casinoView: true,
    failBalance: false,
}));
vi.mock("../src/auth.js", async importOriginal => {
    const actual = await importOriginal<typeof import("../src/auth.js")>();
    return { ...actual, loadSession: async () => mocks.session };
});
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => ({
        get: async (key: string) => mocks.cache.get(key) ?? null,
        set: async (key: string, value: string) => { mocks.cache.set(key, value); },
        del: async (key: string) => { mocks.cache.delete(key); },
    }),
}));
vi.mock("../src/classes/Player.js", () => ({
    default: { findById: mocks.findById, invalidate: mocks.invalidate, exists: vi.fn() },
}));
vi.mock("../src/api/lobbies.js", () => ({ default: vi.fn() }));
vi.mock("node:crypto", async importOriginal => {
    const actual = await importOriginal<typeof import("node:crypto")>();
    return { ...actual, randomInt: mocks.random };
});

import casinoRouter from "../src/api/casino.js";

let server: Server;
let baseUrl: string;
const originalDeveloperId = process.env.DEVELOPER_ID;
const post = (path: string, body: object) => fetch(`${baseUrl}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const state = (id: string, changes: object = {}) => {
    mocks.cache.set(`blackjack:${id}`, JSON.stringify({
        bet: 10, player: [{ rank: "5", suit: "♠" }, { rank: "6", suit: "♠" }],
        dealer: [{ rank: "4", suit: "♠" }, { rank: "10", suit: "♠" }], ...changes,
    }));
};

beforeAll(async () => {
    process.env.DEVELOPER_ID = "developer";
    const app = express();
    app.use(express.json(), casinoRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
    if (originalDeveloperId === undefined) delete process.env.DEVELOPER_ID;
    else process.env.DEVELOPER_ID = originalDeveloperId;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
    mocks.session = { id: "developer", username: "Developer" };
    mocks.cache.clear();
    mocks.casinoView = true;
    mocks.failBalance = false;
    mocks.random.mockReset().mockReturnValue(0);
    mocks.query.mockReset().mockImplementation(async (sql: string) => {
        if (sql.includes("debug_settings")) return { rowCount: mocks.casinoView ? 0 : 1 };
        if (sql.includes("UPDATE players") && mocks.failBalance) return { rowCount: 0, rows: [] };
        return sql.includes("INSERT INTO casino_bets") ? { rowCount: 1 } : { rowCount: 1, rows: [{ balance: "1000" }] };
    });
    mocks.findById.mockReset().mockResolvedValue({ balance: 1000, casinoPayoutMultiplier: 1 });
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
});

describe("developer blackjack preview", () => {
    test("reserves the next card at deal, survives reload and is consumed on hit", async () => {
        mocks.random.mockReturnValueOnce(4).mockReturnValueOnce(0)
            .mockReturnValueOnce(5).mockReturnValueOnce(0)
            .mockReturnValueOnce(3).mockReturnValueOnce(0)
            .mockReturnValueOnce(9).mockReturnValueOnce(0)
            .mockReturnValueOnce(2).mockReturnValueOnce(1)
            .mockReturnValueOnce(6).mockReturnValueOnce(2);
        const start = await post("/blackjack/start", { bet: 10 });
        const dealt = await start.json();
        expect(start.headers.get("cache-control")).toBe("no-store");
        expect(dealt.nextCard).toEqual({ rank: "3", suit: "♥" });
        expect(dealt.advice).toEqual(expect.objectContaining({
            recommended: expect.any(String),
            stand: expect.objectContaining({ win: expect.any(Number), expectedNet: expect.any(Number) }),
            hit: expect.any(Object), double: expect.any(Object),
        }));
        expect(dealt.dealer).toEqual([{ rank: "4", suit: "♠" }, { rank: "10", suit: "♠" }]);
        expect(dealt.dealerTotal).toBe(14);
        expect(dealt.dealerHidden).toBe(false);
        const resumed = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(resumed.nextCard).toEqual(dealt.nextCard);
        const hit = await (await post("/blackjack/action", { action: "hit" })).json();
        expect(hit.player.at(-1)).toEqual(dealt.nextCard);
        expect(hit.nextCard).toEqual({ rank: "7", suit: "♦" });
        expect(hit.advice.double).toBeNull();
        expect((await (await fetch(`${baseUrl}/blackjack`)).json()).nextCard).toEqual(hit.nextCard);
    });

    test("double consumes the preview and removes it once the round finishes", async () => {
        state("developer", { nextCard: { rank: "10", suit: "♦" } });
        const result = await (await post("/blackjack/action", { action: "double" })).json();
        expect(result.player.at(-1)).toEqual({ rank: "10", suit: "♦" });
        expect(result.active).toBe(false);
        expect(result).not.toHaveProperty("nextCard");
        expect(result).not.toHaveProperty("advice");
        expect(mocks.cache.has("blackjack:developer")).toBe(false);
    });

    test("stand gives the preview to the dealer when the dealer draws, but not when standing on 17", async () => {
        const nextCard = { rank: "4", suit: "♥" };
        state("developer", { nextCard });
        const result = await (await post("/blackjack/action", { action: "stand" })).json();
        expect(result.dealer[2]).toEqual(nextCard);
        expect(result).not.toHaveProperty("nextCard");
        state("developer", { nextCard, dealer: [{ rank: "10", suit: "♠" }, { rank: "7", suit: "♣" }] });
        const standing = await (await post("/blackjack/action", { action: "stand" })).json();
        expect(standing.dealer).toHaveLength(2);
        expect(standing).not.toHaveProperty("nextCard");
    });

    test("adds a stable preview to legacy hands and preserves it when an action is rejected", async () => {
        state("developer");
        const first = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(first.nextCard).toEqual({ rank: "A", suit: "♠" });
        mocks.failBalance = true;
        expect((await post("/blackjack/action", { action: "double" })).status).toBe(400);
        mocks.failBalance = false;
        expect((await (await fetch(`${baseUrl}/blackjack`)).json()).nextCard).toEqual(first.nextCard);
    });

    test("toggling view off and back on during a hand hides and restores both previews without changing the next card", async () => {
        state("developer", { nextCard: { rank: "3", suit: "♦" } });
        const enabled = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(enabled.nextCard).toEqual({ rank: "3", suit: "♦" });
        expect(enabled.dealer).toHaveLength(2);
        mocks.casinoView = false;
        const disabled = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(disabled).not.toHaveProperty("nextCard");
        expect(disabled).not.toHaveProperty("advice");
        expect(disabled.dealer).toHaveLength(1);
        expect(disabled.dealerHidden).toBe(true);
        mocks.casinoView = true;
        const restored = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(restored.nextCard).toEqual(enabled.nextCard);
        expect(restored.dealer).toEqual(enabled.dealer);
        mocks.casinoView = false;
        const hit = await (await post("/blackjack/action", { action: "hit" })).json();
        expect(hit.player.at(-1)).toEqual(enabled.nextCard);
        expect(hit).not.toHaveProperty("nextCard");
        expect(hit.dealer).toHaveLength(1);
        mocks.casinoView = true;
        const afterHit = await (await fetch(`${baseUrl}/blackjack`)).json();
        expect(afterHit.nextCard).toBeDefined();
        expect(afterHit.dealer).toHaveLength(2);
    });

    test("never exposes a stored preview to other players, even when requested or configured developer ID is missing", async () => {
        mocks.session = { id: "other", username: "Other" };
        state("other", { nextCard: { rank: "3", suit: "♦" } });
        const resumed = await (await fetch(`${baseUrl}/blackjack?developer=true`)).json();
        expect(resumed).not.toHaveProperty("nextCard");
        expect(resumed).not.toHaveProperty("advice");
        expect(resumed.dealer).toHaveLength(1);
        const hit = await (await post("/blackjack/action", { action: "hit", developer: true })).json();
        expect(hit.player.at(-1)).toEqual({ rank: "3", suit: "♦" });
        expect(hit).not.toHaveProperty("nextCard");
        expect(hit).not.toHaveProperty("advice");
        delete process.env.DEVELOPER_ID;
        mocks.session = { id: "developer", username: "Developer" };
        state("developer", { nextCard: { rank: "3", suit: "♦" } });
        expect(await (await fetch(`${baseUrl}/blackjack`)).json()).not.toHaveProperty("nextCard");
        process.env.DEVELOPER_ID = "developer";
        mocks.session = null;
        expect((await fetch(`${baseUrl}/blackjack`)).status).toBe(401);
    });

    test("normal hands do not reserve or expose an extra card", async () => {
        mocks.session = { id: "other", username: "Other" };
        mocks.random.mockReturnValueOnce(4).mockReturnValueOnce(0)
            .mockReturnValueOnce(5).mockReturnValueOnce(0)
            .mockReturnValueOnce(3).mockReturnValueOnce(0)
            .mockReturnValueOnce(9).mockReturnValueOnce(0);
        const result = await (await post("/blackjack/start", { bet: 10 })).json();
        expect(result.active).toBe(true);
        expect(result).not.toHaveProperty("nextCard");
        expect(JSON.parse(mocks.cache.get("blackjack:other")!)).not.toHaveProperty("nextCard");
        expect(mocks.random).toHaveBeenCalledTimes(8);
    });
});
