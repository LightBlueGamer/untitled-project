import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ user: null as { id: string } | null, buy: vi.fn(), get: vi.fn(), history: vi.fn(), alert: vi.fn(), read: vi.fn() }));
vi.mock("../src/auth.js", () => ({ loadSession: async () => mocks.user }));
vi.mock("../src/botShop.js", () => ({
    BotShopError: class BotShopError extends Error { constructor(message: string, public status = 400) { super(message); } },
    buyBotShopItem: mocks.buy, getBotShop: mocks.get, getBotShopHistory: mocks.history,
    botShopAlert: mocks.alert, readBotShopAlert: mocks.read,
}));
import router from "../src/api/routes/botShop.js";

let server: Server;
let url: string;
beforeAll(async () => {
    const app = express();
    app.use("/api/bot-shop", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/bot-shop`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { mocks.user = { id: "owner" }; mocks.buy.mockReset(); mocks.get.mockReset(); mocks.history.mockReset(); mocks.alert.mockReset(); mocks.read.mockReset(); });
const post = (body: object, headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }) =>
    fetch(`${url}/buy`, { method: "POST", headers, body: JSON.stringify(body) });

describe("Bot Shop API", () => {
    test("exposes paginated history and rejects invalid pages", async () => {
        mocks.history.mockResolvedValue({ entries: [], hasMore: false });
        expect((await fetch(`${url}/history?page=2`)).status).toBe(200);
        expect(mocks.history).toHaveBeenCalledWith(2);
        expect((await fetch(`${url}/history?page=-1`)).status).toBe(400);
    });

    test("restricts alert state and mark-read to authenticated users", async () => {
        mocks.user = null;
        expect((await fetch(`${url}/alert`)).status).toBe(401);
        expect((await fetch(`${url}/alert/read`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: '{"generation":"1"}' })).status).toBe(401);
        mocks.user = { id: "owner" };
        mocks.alert.mockResolvedValue({ generation: "1", unread: true });
        expect((await fetch(`${url}/alert`)).status).toBe(200);
        expect(mocks.alert).toHaveBeenCalledWith("owner");
        const headers = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
        expect((await fetch(`${url}/alert/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"generation":"1"}' })).status).toBe(400);
        expect((await fetch(`${url}/alert/read`, { method: "POST", headers, body: '{"generation":"-1"}' })).status).toBe(400);
        expect((await fetch(`${url}/alert/read`, { method: "POST", headers, body: '{"generation":"1","playerId":"other"}' })).status).toBe(200);
        expect(mocks.read).toHaveBeenCalledWith("owner", "1");
    });
    test("allows public stock access without caching", async () => {
        mocks.user = null;
        mocks.get.mockResolvedValue({ generation: "1", items: [] });
        const response = await fetch(url);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
    });

    test("requires login and JSON request header", async () => {
        mocks.user = null;
        expect((await post({ key: "wild_berries", quantity: 1, generation: "1" })).status).toBe(401);
        mocks.user = { id: "owner" };
        expect((await post({}, { "Content-Type": "application/json" })).status).toBe(400);
        expect(mocks.buy).not.toHaveBeenCalled();
    });

    test("validates purchases and uses only the signed-in player", async () => {
        const valid = { key: "wild_berries", quantity: 1, generation: "1", playerId: "someone-else" };
        for (const change of [{ key: "" }, { quantity: -1 }, { quantity: 1.5 }, { quantity: "1" }, { generation: "0" }, { generation: 1 }]) {
            expect((await post({ ...valid, ...change })).status).toBe(400);
        }
        expect(mocks.buy).not.toHaveBeenCalled();
        expect((await post(valid)).status).toBe(200);
        expect(mocks.buy).toHaveBeenCalledWith("owner", "wild_berries", 1, "1");
    });
});
