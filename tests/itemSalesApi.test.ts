import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ session: null as { id: string } | null, sell: vi.fn() }));
vi.mock("../src/auth.js", () => ({ loadSession: async () => mocks.session }));
vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/itemStorage.js", async importOriginal => ({
    ...await importOriginal<typeof import("../src/itemStorage.js")>(),
    sellPlayerItem: mocks.sell,
}));

import router from "../src/api/routes/items.js";
import { items } from "../src/resources/items.js";

let server: Server;
let url: string;

beforeAll(async () => {
    const app = express();
    app.use("/api/items", router);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/api/items/sell`;
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
    mocks.session = { id: "owner" };
    mocks.sell.mockReset();
});

const sell = (body: object) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("website item sales", () => {
    test("requires login and JSON", async () => {
        mocks.session = null;
        expect((await sell({ item: "wild_berries", quantity: 1 })).status).toBe(401);
        mocks.session = { id: "owner" };
        expect((await fetch(url, { method: "POST", body: "item=wild_berries&quantity=1" })).status).toBe(415);
        expect(mocks.sell).not.toHaveBeenCalled();
    });

    test("uses the session owner and reports sale proceeds and unequipped tools", async () => {
        mocks.sell.mockResolvedValue({ status: "sold", item: items.iron_pick, amount: 1, proceeds: 50, unequipped: true });
        const result = await sell({ playerId: "another-player", item: "iron_pick", quantity: 1 });
        expect(result.status).toBe(200);
        expect(result.headers.get("cache-control")).toBe("no-store");
        expect(mocks.sell).toHaveBeenCalledWith("owner", "iron_pick", 1);
        expect(await result.json()).toEqual({ item: "Iron Pick", quantity: 1, proceeds: 50, unequipped: true });
    });

    test("rejects malformed, fractional, negative and unsafe quantities", async () => {
        for (const body of [{ quantity: 1 }, { item: "iron_pick", quantity: 0 }, { item: "iron_pick", quantity: -1 },
            { item: "iron_pick", quantity: 1.5 }, { item: "iron_pick", quantity: "1" },
            { item: "iron_pick", quantity: Number.MAX_SAFE_INTEGER + 1 }]) {
            expect((await sell(body)).status).toBe(400);
        }
        expect(mocks.sell).not.toHaveBeenCalled();
    });

    test("reports invalid or insufficient inventory without a success response", async () => {
        mocks.sell.mockResolvedValueOnce({ status: "invalid" }).mockResolvedValueOnce({ status: "unowned", owned: 2 });
        expect((await sell({ item: "missing", quantity: 1 })).status).toBe(400);
        const result = await sell({ item: "wild_berries", quantity: 3 });
        expect(result.status).toBe(409);
        expect(await result.json()).toMatchObject({ owned: 2 });
    });
});
