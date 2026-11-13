import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ session: null as { id: string } | null, create: vi.fn(), bid: vi.fn(), account: vi.fn(), list: vi.fn() }));
vi.mock("../src/auth.js", () => ({ loadSession: async () => mocks.session }));
vi.mock("../src/auctionStorage.js", () => ({
    AuctionError: class AuctionError extends Error { constructor(message: string, public status = 400) { super(message); } },
    createAuction: mocks.create, bidAuction: mocks.bid, auctionAccount: mocks.account,
    auctionDetail: vi.fn(), auctionInventory: vi.fn(), claimAuction: vi.fn(), endAuction: vi.fn(),
    listAuctions: mocks.list, promoteAuction: vi.fn(), readAuctionNotifications: vi.fn(),
}));
import router from "../src/api/routes/auctions.js";

let server: Server;
let url: string;
beforeAll(async () => {
    const app = express();
    app.use("/api/auctions", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/auctions`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => { mocks.session = { id: "owner" }; mocks.create.mockReset(); mocks.bid.mockReset(); mocks.account.mockReset(); mocks.list.mockReset(); });

const post = (path: string, body: object, headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }) =>
    fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("auction API", () => {
    test("paginates public listings and validates page numbers", async () => {
        mocks.list.mockResolvedValue(Array.from({ length: 51 }, (_, id) => ({ id })));
        const response = await fetch(`${url}?page=1`);
        expect(await response.json()).toMatchObject({ auctions: Array.from({ length: 50 }, (_, id) => ({ id })), hasMore: true });
        expect(mocks.list).toHaveBeenCalledWith(1);
        expect((await fetch(`${url}?page=-1`)).status).toBe(400);
        expect((await fetch(`${url}?page=1.5`)).status).toBe(400);
    });
    test("requires authentication and the JSON request header", async () => {
        mocks.session = null;
        expect((await fetch(`${url}/account`)).status).toBe(401);
        expect((await post("/1/bid", { amount: 100 })).status).toBe(401);
        mocks.session = { id: "owner" };
        expect((await post("/1/bid", { amount: 100 }, { "Content-Type": "application/json" })).status).toBe(400);
        expect(mocks.bid).not.toHaveBeenCalled();
    });

    test("validates listings and binds the seller to the session", async () => {
        const valid = { kind: "item", key: "wild_berries", quantity: 1, title: " Berries ", description: " Fresh ", price: 100, hours: 2, seller: "someone-else" };
        mocks.create.mockResolvedValue({ id: "1" });
        const response = await post("", valid);
        expect(response.status).toBe(201);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mocks.create).toHaveBeenCalledWith("owner", { kind: "item", key: "wild_berries", quantity: 1, title: "Berries", description: "Fresh", price: 100, hours: 2 });
        mocks.create.mockClear();
        for (const change of [{ kind: "unknown" }, { key: "" }, { quantity: -1 }, { quantity: 1.5 }, { price: 1e12 }, { hours: 169 }, { title: " " }]) {
            expect((await post("", { ...valid, ...change })).status).toBe(400);
        }
        expect(mocks.create).not.toHaveBeenCalled();
    });

    test("validates bids and passes the authenticated bidder", async () => {
        for (const amount of [0, -1, 1.5, 1e12, "100"]) expect((await post("/1/bid", { amount })).status).toBe(400);
        expect(mocks.bid).not.toHaveBeenCalled();
        expect((await post("/1/bid", { amount: 100, bidder: "other" })).status).toBe(200);
        expect(mocks.bid).toHaveBeenCalledWith("1", "owner", 100);
    });
});
