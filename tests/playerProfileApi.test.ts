import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
import Player from "../src/classes/Player.js";
import router from "../src/api/routes/player.js";

let server: Server;
let url: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/players", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/players`;
});

afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("player profile XP", () => {
    test.each([1, 5, 20])("includes the current level's requirement at level %i", async level => {
        const player = new Player("Test", "1", { level, experience: 25 });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const response = await fetch(`${url}/1`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            level, experience: 25, requiredXP: player.xpForNextLevel(level),
        });
        vi.restoreAllMocks();
    });

    test("preserves the not-found response", async () => {
        vi.spyOn(Player, "findById").mockResolvedValue(null);
        expect((await fetch(`${url}/missing`)).status).toBe(404);
        vi.restoreAllMocks();
    });
});
