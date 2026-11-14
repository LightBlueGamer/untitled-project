import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn(), lRange: vi.fn(), refreshShop: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getCache: () => ({ get: mocks.get, lRange: mocks.lRange }),
    getPool: () => ({ query: mocks.query }),
}));
vi.mock("../src/botShop.js", () => ({ refreshBotShop: mocks.refreshShop }));

import { authApiRouter, requireDeveloper } from "../src/auth.js";
import developerRouter from "../src/api/developer.js";

let server: Server;
let url: string;
const cookie = `ledger_session=${"a".repeat(43)}`;

beforeAll(async () => {
    const app = express();
    app.use("/api/auth", authApiRouter);
    app.use("/api/developer", requireDeveloper, express.json(), developerRouter);
    app.get("/developer", requireDeveloper, (_request, response) => response.send("private page"));
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
    vi.stubEnv("DEVELOPER_ID", "developer");
    mocks.get.mockReset().mockResolvedValue(null);
    mocks.query.mockReset().mockResolvedValue({ rowCount: 0 });
    mocks.lRange.mockReset().mockResolvedValue([]);
    mocks.refreshShop.mockReset();
});

function login(id: string) {
    mocks.get.mockResolvedValue(JSON.stringify({ id, username: "test", displayName: "Test" }));
}

describe("developer dashboard authorization", () => {
    test("restricts House Learns profiles and returns the actual strategy for a selected player", async () => {
        const path = `${url}/api/developer/house-learns/players/123`;
        expect((await fetch(path)).status).toBe(401);
        login("other");
        expect((await fetch(path, { headers: { cookie } })).status).toBe(403);
        expect(mocks.query).not.toHaveBeenCalled();
        login("developer");
        const player = { actions: 10, raises: 4, calls: 4, folds: 2 };
        const global = { actions: 100, raises: 30, calls: 50, folds: 20 };
        mocks.query.mockResolvedValueOnce({ rows: [{ id: "123", name: "Player", player, global }] });
        const response = await fetch(path, { headers: { cookie } });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
            id: "123", name: "Player", player, global,
            tactics: { aggression: 9 / 26, foldRate: 5 / 24, foldAdjustment: 9 / 26 * 0.12, bluffChance: 0.03 + 5 / 24 * 0.25 },
        });
        expect(mocks.query.mock.calls[0][1]).toEqual(["123"]);
        mocks.query.mockResolvedValueOnce({ rows: [{ id: "456", name: "New", player: null, global: null }] });
        const empty = await (await fetch(`${url}/api/developer/house-learns/players/456`, { headers: { cookie } })).json();
        expect(empty.player.actions).toBe(0);
        expect(empty.global.actions).toBe(0);
        mocks.query.mockResolvedValueOnce({ rows: [] });
        expect((await fetch(path, { headers: { cookie } })).status).toBe(404);
    });

    test("searches House Learns players with bounded pagination", async () => {
        login("developer");
        const rows = Array.from({ length: 21 }, (_, index) => ({ id: String(index).padStart(2, "0"), name: "Player", learned: true }));
        mocks.query.mockResolvedValueOnce({ rows });
        const response = await fetch(`${url}/api/developer/house-learns/players?search=test&after=01`, { headers: { cookie } });
        const body = await response.json();
        expect(body.players).toHaveLength(20);
        expect(body.next).toBe("19");
        expect(mocks.query.mock.calls[0][1]).toEqual(["test", "01"]);
        expect((await fetch(`${url}/api/developer/house-learns/players?search=${"x".repeat(101)}`, { headers: { cookie } })).status).toBe(400);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.query.mockRejectedValueOnce(new Error("offline"));
        expect((await fetch(`${url}/api/developer/house-learns/players`, { headers: { cookie } })).status).toBe(500);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    test("only the developer can restock the shop with the required request header", async () => {
        const headers = { cookie, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
        const refresh = (requestHeaders = headers) => fetch(`${url}/api/developer/bot-shop/refresh`, { method: "POST", headers: requestHeaders, body: "{}" });
        expect((await refresh()).status).toBe(401);
        login("other");
        expect((await refresh()).status).toBe(403);
        login("developer");
        expect((await refresh({ ...headers, "X-Requested-With": "" })).status).toBe(400);
        expect(mocks.refreshShop).not.toHaveBeenCalled();
        expect((await refresh()).status).toBe(200);
        expect(mocks.refreshShop).toHaveBeenCalledOnce();
    });
    test("rejects anonymous and other accounts for both page and API", async () => {
        expect((await fetch(`${url}/developer`)).status).toBe(401);
        expect((await fetch(`${url}/api/developer`)).status).toBe(401);
        login("other");
        expect((await fetch(`${url}/developer`, { headers: { cookie } })).status).toBe(403);
        expect((await fetch(`${url}/api/developer`, { headers: { cookie } })).status).toBe(403);
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.lRange).not.toHaveBeenCalled();
    });

    test("fails closed without a configured ID and hides developer navigation", async () => {
        vi.stubEnv("DEVELOPER_ID", "");
        login("developer");
        expect((await fetch(`${url}/developer`, { headers: { cookie } })).status).toBe(403);
        const response = await fetch(`${url}/api/auth/me`, { headers: { cookie } });
        expect(await response.json()).toMatchObject({ isDeveloper: false });
    });

    test("lets only the configured developer read settings and logs", async () => {
        login("developer");
        mocks.query.mockResolvedValueOnce({ rowCount: 1 });
        mocks.lRange.mockResolvedValue([JSON.stringify({ topic: "chance", message: "one" })]);
        const page = await fetch(`${url}/developer`, { headers: { cookie } });
        expect(page.status).toBe(200);
        expect(page.headers.get("cache-control")).toBe("no-store");
        const response = await fetch(`${url}/api/developer`, { headers: { cookie } });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
            settings: { chance: true, rewards: false, gambling: false, lootboxes: false },
            logs: [{ topic: "chance", message: "one" }],
            casinoView: true,
        });
        const auth = await fetch(`${url}/api/auth/me`, { headers: { cookie } });
        expect(await auth.json()).toMatchObject({ isDeveloper: true });
    });

    test("only the developer can toggle the persistent casino view", async () => {
        const headers = { cookie, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
        const put = (body: string, requestHeaders = headers) =>
            fetch(`${url}/api/developer/casino-view`, { method: "PUT", headers: requestHeaders, body });
        expect((await put('{"enabled":false}')).status).toBe(401);
        login("other");
        expect((await put('{"enabled":false}')).status).toBe(403);
        login("developer");
        expect((await put('{"enabled":"false"}')).status).toBe(400);
        expect((await put('{"enabled":false}', { ...headers, "X-Requested-With": "" })).status).toBe(400);
        expect(mocks.query).not.toHaveBeenCalled();
        expect(await (await put('{"enabled":false}')).json()).toEqual({ enabled: false });
        expect(mocks.query.mock.calls[0][0]).toContain("INSERT INTO debug_settings");
        expect(mocks.query.mock.calls[0][1]).toEqual(["casino_view_disabled", "global"]);
        expect(await (await put('{"enabled":true}')).json()).toEqual({ enabled: true });
        expect(mocks.query.mock.calls[1][0]).toContain("DELETE FROM debug_settings");
        mocks.query.mockRejectedValueOnce(new Error("offline"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await put('{"enabled":false}')).status).toBe(500);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    test("casino view changes survive dashboard reloads", async () => {
        login("developer");
        let disabled = false;
        mocks.query.mockImplementation(async (sql: string, values: string[]) => {
            if (values[0] !== "casino_view_disabled") return { rowCount: 0 };
            if (sql.startsWith("INSERT")) disabled = true;
            if (sql.startsWith("DELETE")) disabled = false;
            return { rowCount: disabled ? 1 : 0 };
        });
        const headers = { cookie, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
        const read = async () => (await (await fetch(`${url}/api/developer`, { headers: { cookie } })).json()).casinoView;
        expect(await read()).toBe(true);
        await fetch(`${url}/api/developer/casino-view`, { method: "PUT", headers, body: '{"enabled":false}' });
        expect(await read()).toBe(false);
        await fetch(`${url}/api/developer/casino-view`, { method: "PUT", headers, body: '{"enabled":true}' });
        expect(await read()).toBe(true);
    });

    test("validates settings writes and blocks cross-origin form requests", async () => {
        login("developer");
        const headers = { cookie, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
        const put = (topic: string, body: string, requestHeaders = headers) =>
            fetch(`${url}/api/developer/settings/${topic}`, { method: "PUT", headers: requestHeaders, body });
        expect((await put("invalid", '{"enabled":true}')).status).toBe(400);
        expect((await put("chance", '{"enabled":"true"}')).status).toBe(400);
        expect((await put("chance", '{"enabled":true}', { ...headers, "X-Requested-With": "" })).status).toBe(400);
        expect(mocks.query).not.toHaveBeenCalled();
        const response = await put("chance", '{"enabled":true}');
        expect(response.status).toBe(200);
        expect(mocks.query.mock.calls[0][1]).toEqual(["chance", "global"]);
        expect((await put("lootboxes", '{"enabled":true}')).status).toBe(200);
        expect(mocks.query.mock.calls[1][1]).toEqual(["lootboxes", "global"]);
        login("other");
        expect((await put("chance", '{"enabled":false}')).status).toBe(403);
        expect(mocks.query).toHaveBeenCalledTimes(2);
    });

    test("reports storage errors", async () => {
        login("developer");
        mocks.lRange.mockRejectedValue(new Error("offline"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const response = await fetch(`${url}/api/developer`, { headers: { cookie } });
        expect(response.status).toBe(500);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
