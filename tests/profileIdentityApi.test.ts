import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), del: vi.fn(), discord: vi.fn(), updateLobby: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getPool: () => ({ query: mocks.query }),
    getCache: () => ({ del: mocks.del }),
}));
vi.mock("../src/auth.js", () => ({ loadSession: mocks.session }));
vi.mock("../src/discordProfile.js", () => ({ getDiscordProfile: mocks.discord }));
vi.mock("../src/profileNameEvents.js", () => ({ profileNameEvents: { emit: mocks.updateLobby } }));
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
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
    vi.restoreAllMocks();
    mocks.session.mockReset().mockResolvedValue(null);
    mocks.query.mockReset().mockResolvedValue({ rowCount: 1 });
    mocks.del.mockReset().mockResolvedValue(1);
    mocks.discord.mockReset().mockResolvedValue(null);
    mocks.updateLobby.mockReset();
});

describe("profile identity API", () => {
    const headers = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
    const rename = (name: unknown, extraHeaders = headers) => fetch(`${url}/me/name`, {
        method: "PUT", headers: extraHeaders, body: JSON.stringify({ name }),
    });

    test("only updates the logged-in account and invalidates its cache", async () => {
        expect((await rename("Hero")).status).toBe(401);
        mocks.session.mockResolvedValue({ id: "owner" });
        const response = await rename("  Hero  ");
        expect(await response.json()).toEqual({ name: "Hero" });
        expect(mocks.query.mock.calls[0][1]).toEqual(["owner", "Hero"]);
        expect(mocks.del).toHaveBeenCalledWith("player:owner");
        expect(mocks.updateLobby).toHaveBeenCalledWith("changed", "owner", "Hero");
        expect(response.headers.get("cache-control")).toBe("no-store");
    });

    test("rejects invalid names and requests without the CSRF header", async () => {
        mocks.session.mockResolvedValue({ id: "owner" });
        for (const name of ["", " ", "a".repeat(33), "@everyone", "<@123>", "line\nbreak", 123]) {
            expect((await rename(name)).status).toBe(400);
        }
        expect((await rename("Hero", { ...headers, "X-Requested-With": "" })).status).toBe(400);
        expect(mocks.query).not.toHaveBeenCalled();
    });

    test("reports a missing player and database failure", async () => {
        mocks.session.mockResolvedValue({ id: "owner" });
        mocks.query.mockResolvedValueOnce({ rowCount: 0 }).mockRejectedValueOnce(new Error("offline"));
        expect((await rename("Hero")).status).toBe(404);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await rename("Hero")).status).toBe(500);
        expect(error).toHaveBeenCalled();
    });

    test("reports when a saved name cannot be invalidated", async () => {
        mocks.session.mockResolvedValue({ id: "owner" });
        mocks.del.mockRejectedValue(new Error("offline"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const response = await rename("Hero");
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("name was saved") });
    });

    test("includes the Discord avatar and username on public profiles", async () => {
        vi.spyOn(Player, "findById").mockResolvedValue(new Player("Hero", "123", { level: 1 }));
        mocks.discord.mockResolvedValue({ username: "discorduser", avatarUrl: "https://cdn.discordapp.com/example" });
        const response = await fetch(`${url}/123`);
        expect(await response.json()).toMatchObject({
            name: "Hero", discord: { username: "discorduser", avatarUrl: "https://cdn.discordapp.com/example" },
        });
        expect(mocks.discord).toHaveBeenCalledWith("123");
    });
});
