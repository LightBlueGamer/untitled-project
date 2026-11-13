import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn(), lRange: vi.fn() }));
vi.mock("../src/database.js", () => ({
    getCache: () => ({ get: mocks.get, lRange: mocks.lRange }),
    getPool: () => ({ query: mocks.query }),
}));

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
});

function login(id: string) {
    mocks.get.mockResolvedValue(JSON.stringify({ id, username: "test", displayName: "Test" }));
}

describe("developer dashboard authorization", () => {
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
        });
        const auth = await fetch(`${url}/api/auth/me`, { headers: { cookie } });
        expect(await auth.json()).toMatchObject({ isDeveloper: true });
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
