import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    enabled: true,
    query: vi.fn(),
    invalidate: vi.fn(),
    names: [] as string[],
}));
vi.mock("../src/auth.js", async importOriginal => {
    const actual = await importOriginal<typeof import("../src/auth.js")>();
    return {
        ...actual,
        loadSession: async (cookie?: string) => cookie ? { id: cookie, username: cookie } : null,
    };
});
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => ({}),
}));
vi.mock("../src/classes/Player.js", () => ({
    default: {
        findById: vi.fn(async () => ({ balance: 10000, casinoPayoutMultiplier: 1 })),
        invalidate: mocks.invalidate,
    },
}));

import casinoRouter from "../src/api/casino.js";

let server: Server;
let url: string;
const originalDeveloperId = process.env.DEVELOPER_ID;

async function request(user: string, path: string, body?: object) {
    const response = await fetch(`${url}/lobbies${path}`, {
        method: body ? "POST" : "GET",
        headers: { cookie: user, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    expect(response.status, JSON.stringify(data)).toBe(200);
    return data;
}

beforeAll(async () => {
    process.env.DEVELOPER_ID = "developer";
    const app = express();
    app.use(express.json(), casinoRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
    if (originalDeveloperId === undefined) delete process.env.DEVELOPER_ID;
    else process.env.DEVELOPER_ID = originalDeveloperId;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
    mocks.enabled = true;
    mocks.names = [];
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.query.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
        if (sql.includes("debug_settings")) return { rows: [], rowCount: mocks.enabled ? 0 : 1 };
        if (sql.includes("SELECT name FROM")) return { rows: mocks.names.map(name => ({ name })), rowCount: mocks.names.length };
        if (sql.includes("SELECT data->>'name'")) return { rows: [{ name: params[0] }], rowCount: 1 };
        if (sql.includes("UPDATE players")) return { rows: [{ balance: "9800" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
    });
});

describe("developer poker view", () => {
    test("reveals private hands and the real upcoming board only to the enabled developer", async () => {
        const created = await request("developer", "", { game: "poker", bet: 200, maxPlayers: 2, bots: 0 });
        const id: string = created.lobby.id;
        await request("opponent", `/${id}/join`, {});
        const started = (await request("developer", `/${id}/start`, {})).lobby;
        expect(started.poker.active).toBe(true);
        const opponentHand = started.poker.seats.find((seat: { id: string }) => seat.id === "opponent").hole;
        expect(opponentHand).toHaveLength(2);
        expect(started.poker.upcomingCommunity).toHaveLength(5);
        expect(started.poker.predictedWinners.length).toBeGreaterThan(0);
        for (const seat of started.poker.seats) {
            expect(seat.currentHand).toMatch(/^(High card|Pair)$/);
            expect(seat.equity).toBeGreaterThanOrEqual(0);
            expect(seat.equity).toBeLessThanOrEqual(100);
        }
        const prediction = started.poker.upcomingCommunity;
        const opponent = (await request("opponent", `/${id}`)).lobby;
        expect(opponent.poker).not.toHaveProperty("upcomingCommunity");
        expect(opponent.poker).not.toHaveProperty("predictedWinners");
        expect(opponent.poker.seats.find((seat: { id: string }) => seat.id === "developer")).not.toHaveProperty("currentHand");
        expect(opponent.poker.seats.every((seat: object) => !("equity" in seat))).toBe(true);
        expect(opponent.poker.seats.find((seat: { id: string }) => seat.id === "opponent").currentHand).toBeDefined();
        expect(opponent.poker.seats.find((seat: { id: string }) => seat.id === "developer").hole).toEqual([]);
        expect(opponent.poker.myHole).toEqual(opponentHand);
        expect((await request("developer", "/mine")).lobby.poker.upcomingCommunity).toEqual(prediction);
        expect((await request("developer", "/mine")).lobby.poker.seats.map((seat: { equity: number }) => seat.equity))
            .toEqual(started.poker.seats.map((seat: { equity: number }) => seat.equity));

        mocks.enabled = false;
        const hidden = (await request("developer", `/${id}`)).lobby;
        expect(hidden.poker).not.toHaveProperty("upcomingCommunity");
        expect(hidden.poker).not.toHaveProperty("predictedWinners");
        expect(hidden.poker.seats.every((seat: object) => !("equity" in seat))).toBe(true);
        expect(hidden.poker.seats.find((seat: { id: string }) => seat.id === "opponent").hole).toEqual([]);
        mocks.enabled = true;

        let current = (await request("developer", `/${id}`)).lobby;
        for (let i = 0; i < 4 && current.poker.community.length === 0; i++) {
            const turn = current.poker.turnId;
            current = (await request(turn, `/${id}/action`, { action: "call" })).lobby;
        }
        const actual = (await request("developer", `/${id}`)).lobby;
        expect(actual.poker.community).toEqual(prediction.slice(0, 3));
        expect(actual.poker.upcomingCommunity).toEqual(prediction.slice(3));
        current = actual;
        for (let i = 0; i < 10 && current.poker.community.length < 5; i++) {
            current = (await request(current.poker.turnId, `/${id}/action`, { action: "call" })).lobby;
            current = (await request("developer", `/${id}`)).lobby;
            expect(current.poker.community).toEqual(prediction.slice(0, current.poker.community.length));
            expect(current.poker.upcomingCommunity).toEqual(prediction.slice(current.poker.community.length));
        }
        expect(current.poker.community).toEqual(prediction);
        expect((await fetch(`${url}/lobbies/${id}`, { headers: { cookie: "stranger" } })).status).toBe(404);
        await request("developer", `/${id}/leave`, {});
        await request("opponent", `/${id}/leave`, {});
    });

    test("shows bot hands in solo poker and does not add previews to Pass the Bills", async () => {
        mocks.names = ["Other player"];
        const solo = (await request("developer", "", { game: "poker", bet: 200, maxPlayers: 2, bots: 1 })).lobby;
        expect(solo.poker.seats.find((seat: { bot: boolean }) => seat.bot).hole).toHaveLength(2);
        expect(solo.poker.seats.find((seat: { bot: boolean }) => seat.bot).name).toBe("Other player 🤖");
        expect(solo.poker.upcomingCommunity).toHaveLength(5);
        await request("developer", `/${solo.id}/leave`, {});
        const bills = (await request("developer", "", { game: "bills", bet: 10, maxPlayers: 2, bots: 0 })).lobby;
        expect(bills).not.toHaveProperty("poker");
        expect(bills.bills).not.toHaveProperty("upcomingCommunity");
        await request("developer", `/${bills.id}/leave`, {});
    });

    test("uses fallback bot names when player names are unavailable", async () => {
        const solo = (await request("developer", "", { game: "poker", bet: 200, maxPlayers: 3, bots: 2 })).lobby;
        const bots = solo.poker.seats.filter((seat: { bot: boolean }) => seat.bot);
        expect(bots).toHaveLength(2);
        expect(bots.every((seat: { name: string }) => seat.name.endsWith(" 🤖"))).toBe(true);
        expect(new Set(bots.map((seat: { name: string }) => seat.name)).size).toBe(2);
        const query = mocks.query.mock.calls.find(([sql]: [string]) => sql.includes("SELECT name FROM"));
        expect(query?.[1]).toEqual(["developer", 2, "developer"]);
        await request("developer", `/${solo.id}/leave`, {});
    });
});
