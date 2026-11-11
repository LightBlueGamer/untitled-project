import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    findById: vi.fn(),
    invalidate: vi.fn(),
    cache: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock("../src/auth.js", () => ({
    loadSession: async () => ({ id: "player-1" }),
}));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => mocks.cache,
}));
vi.mock("../src/classes/Player.js", () => ({
    default: {
        findById: mocks.findById,
        invalidate: mocks.invalidate,
        exists: vi.fn(),
    },
}));
vi.mock("../src/api/lobbies.js", () => ({ default: vi.fn() }));
vi.mock("node:crypto", () => ({ randomInt: vi.fn(() => 0) }));

import casinoRouter, { applyHousePayoutBonus, plinkoMultipliers } from "../src/api/casino.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/casino", casinoRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    baseUrl = `http://127.0.0.1:${address.port}/api/casino`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
    mocks.query.mockReset();
    mocks.invalidate.mockReset();
    mocks.cache.get.mockReset();
    mocks.cache.set.mockReset();
    mocks.cache.del.mockReset();
    mocks.findById.mockReset().mockResolvedValue({
        balance: 1000,
        casinoPayoutMultiplier: 1.1,
    });
});

describe("house casino payout bonuses", () => {
    test("only boost Plinko multipliers above 1x and preserve base odds", () => {
        const base = plinkoMultipliers(8, "low");
        const boosted = plinkoMultipliers(8, "low", 1.1);
        expect(boosted[0]).toBeGreaterThan(base[0]);
        expect(boosted[4]).toBe(base[4]);
        expect(boosted).toHaveLength(base.length);
    });

    test("only boost winnings above the original stake", () => {
        expect(applyHousePayoutBonus(0, 100, 1.2)).toBe(0);
        expect(applyHousePayoutBonus(100, 100, 1.2)).toBe(100);
        expect(applyHousePayoutBonus(150, 100, 1.2)).toBe(160);
    });

    test("returns the active boost and shows adjusted Plinko multipliers", async () => {
        const [balanceResponse, plinkoResponse] = await Promise.all([
            fetch(`${baseUrl}/balance`),
            fetch(`${baseUrl}/plinko?rows=8&risk=low`),
        ]);
        expect(await balanceResponse.json()).toEqual({
            balance: 1000,
            casinoPayoutMultiplier: 1.1,
        });
        const plinko = await plinkoResponse.json();
        expect(plinko.casinoPayoutMultiplier).toBe(1.1);
        expect(plinko.multipliers).toEqual(plinkoMultipliers(8, "low", 1.1));
    });

    test("uses the active boost for Plinko settlement and returned multipliers", async () => {
        mocks.query.mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ balance: "1000" }],
        }).mockResolvedValueOnce({ rowCount: 1 });
        const response = await fetch(`${baseUrl}/plinko`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bet: 10, balls: 1, rows: 8, risk: "low" }),
        });
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.casinoPayoutMultiplier).toBe(1.1);
        expect(result.multipliers).toEqual(plinkoMultipliers(8, "low", 1.1));
        expect(result.drops[0].payout).toBe(
            Math.floor(10 * result.multipliers[result.drops[0].slot]),
        );
    });

    test("applies the boost to solo Pass the Bills wins only", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance: "1000" }] })
            .mockResolvedValueOnce({ rowCount: 1 });
        const response = await fetch(`${baseUrl}/bills`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bet: 10, players: 3 }),
        });
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.winner).toBe(0);
        expect(result.casinoPayoutMultiplier).toBe(1.1);
        expect(result.payout).toBe(result.stake + Math.floor((result.pot * result.multiplier - result.stake) * 1.1));
    });
});
