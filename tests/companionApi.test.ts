import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    user: null as { id: string } | null,
    player: null as { companions: { key: string; quantity: number }[]; equippedCompanions?: string[] } | null,
    circulation: vi.fn(),
    findById: vi.fn(),
}));
vi.mock("../src/auth.js", () => ({ loadSession: async () => mocks.user }));
vi.mock("../src/classes/Player.js", () => ({ default: { findById: mocks.findById } }));
vi.mock("../src/companionStorage.js", () => ({
    getCompanionCirculation: mocks.circulation,
}));

import router from "../src/api/routes/companions.js";
import { companionSelectionWeights, companions } from "../src/resources/companions.js";

let server: Server;
let url: string;
beforeAll(async () => {
    const app = express();
    app.use("/api/companions", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/companions`;
});
afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
    mocks.user = null;
    mocks.player = null;
    mocks.findById.mockReset();
    mocks.findById.mockImplementation(async () => mocks.player);
    mocks.circulation.mockReset();
});

describe("companion API", () => {
    test("shows circulation for all species and historical keys as exact strings", async () => {
        mocks.circulation.mockResolvedValue([
            { key: "mossprout", quantity: "9007199254740993" }, { key: "retired", quantity: "2" },
        ]);
        const response = await fetch(`${url}/circulation`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const data = await response.json();
        expect(data.companions).toHaveLength(Object.keys(companions).length + 1);
        expect(data.companions).toContainEqual(expect.objectContaining({ key: "mossprout", quantity: "9007199254740993" }));
        expect(data.companions).toContainEqual(expect.objectContaining({ key: "coinling", quantity: "0" }));
        expect(data.companions).toContainEqual({ key: "retired", name: null, rarity: null, quantity: "2" });
    });

    test("mine requires login and exposes the logged-in player's inventory", async () => {
        expect((await fetch(`${url}/mine`)).status).toBe(401);
        mocks.user = { id: "player-a" };
        expect((await fetch(`${url}/mine`)).status).toBe(404);
        mocks.player = { companions: [{ key: "mossprout", quantity: 2 }] };
        const response = await fetch(`${url}/mine`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ companions: [{ key: "mossprout", quantity: 2 }] });
        expect(mocks.findById).toHaveBeenCalledWith("player-a");
    });

    test("public profile inventories identify names, quantities, equipment and retired companions", async () => {
        mocks.player = {
            companions: [{ key: "mossprout", quantity: 3 }, { key: "retired", quantity: 1 }],
            equippedCompanions: ["mossprout"],
        };
        const response = await fetch(`${url}/player/other`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ companions: [
            { key: "mossprout", name: "Mossprout", rarity: "Common", quantity: 3, equipped: true },
            { key: "retired", name: null, rarity: null, quantity: 1, equipped: false },
        ] });
        expect(mocks.findById).toHaveBeenCalledWith("other");
        mocks.player = { companions: [], equippedCompanions: [] };
        expect(await (await fetch(`${url}/player/empty`)).json()).toEqual({ companions: [] });
        mocks.player = null;
        expect((await fetch(`${url}/player/missing`)).status).toBe(404);
    });
    test("wiki reports live circulation-adjusted odds without exposing base weight", async () => {
        const counts = [{ key: "mossprout", quantity: "100" }, { key: "coinling", quantity: "50" }];
        mocks.circulation.mockResolvedValue(counts);
        const response = await fetch(`${url}/wiki/mossprout`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const data = await response.json();
        const weights = companionSelectionWeights(counts);
        const expected = weights.find(item => item.key === "mossprout")!.weight;
        expect(data).toMatchObject({
            name: "Mossprout", rarity: "Common", quantity: "100",
            weight: expected, stats: companions.mossprout.stats, description: companions.mossprout.description,
        });
        expect(data.percentage).toBeCloseTo(expected / weights.reduce((sum, item) => sum + item.weight, 0) * 100, 12);
        expect(data.weight).toBe(companions.mossprout.chanceWeight * 5 / 2);
        expect(data).not.toHaveProperty("chanceWeight");
        expect((await fetch(`${url}/wiki/retired`)).status).toBe(404);
    });
});
