import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    get: vi.fn(),
}));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => ({ get: mocks.get }),
}));

import router from "../src/api/routes/home.js";

let server: Server;
let url: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/home", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/home`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue({ rows: [{
        total_balance: "987654321012345678",
        total_experience: "1234567890123456789",
        top_players: [{ id: "1", name: "<Adventurer>", prestige: 3, level: 20, balance: "999999999999999999" }],
    }] });
    mocks.get.mockReset().mockResolvedValue(JSON.stringify({
        guildCount: 12, uniqueUsers: 345, updatedAt: new Date().toISOString(),
    }));
});

describe("homepage statistics API", () => {
    test("returns player totals, top players, fresh Discord stats, and a bot invite", async () => {
        process.env.DISCORD_CLIENT_ID = "client id";
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
            guildCount: 12,
            uniqueUsers: 345,
            discordStatsUpdatedAt: expect.any(String),
            totalBalance: "987654321012345678",
            totalExperience: "1234567890123456789",
            topPlayers: [{ id: "1", name: "<Adventurer>", prestige: 3, level: 20, balance: "999999999999999999" }],
            inviteUrl: "https://discord.com/oauth2/authorize?client_id=client%20id&scope=bot%20applications.commands&permissions=84992",
            userInstallUrl: "https://discord.com/oauth2/authorize?client_id=client%20id&scope=applications.commands&integration_type=1",
        });
        delete process.env.DISCORD_CLIENT_ID;
    });

    test("marks stale server membership totals unavailable", async () => {
        mocks.get.mockResolvedValue(JSON.stringify({
            guildCount: 12, uniqueUsers: 345, updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }));
        const response = await fetch(url);
        const data = await response.json();
        expect(data.guildCount).toBeNull();
        expect(data.uniqueUsers).toBeNull();
        expect(data.discordStatsUpdatedAt).toBeNull();
    });
});
