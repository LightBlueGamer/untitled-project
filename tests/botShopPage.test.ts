import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    value = "";
    textContent = "";
    innerHTML = "";
    disabled = false;
    tabIndex = 0;
    listeners: Record<string, (event?: unknown) => void> = {};
    classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) };
    addEventListener(event: string, handler: (event?: unknown) => void) { this.listeners[event] = handler; }
    setAttribute() {}
    focus() {}
    contains() { return false; }
}

describe("Bot Shop page", () => {
    test.each([
        ["guest", null, false],
        ["player", { id: "player" }, false],
        ["developer", { id: "developer" }, true],
    ])("only shows the restock button to the %s", async (_label, user, isDeveloper) => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element();
        const context = createContext({
            document: { querySelector: node, activeElement: null },
            window: { setInterval: vi.fn(), addEventListener: vi.fn() },
            location: { hash: "" },
            authReady: Promise.resolve({ user, isDeveloper }),
            fetch: vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/account")
                ? { claims: [], notifications: [] } : url.includes("/inventory") ? { assets: [] } : { auctions: [], hasMore: false } })),
            encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/store.js", "utf8"), context);
        await vi.waitFor(() => expect(node("#refreshBotShop").classList.toggle).toHaveBeenCalledWith("hidden", !isDeveloper));
        expect(readFileSync("public/store.html", "utf8")).toMatch(/id="refreshBotShop" class="[^"]*hidden/);
    });

    test("restocks after confirmation and refreshes the displayed stock and history", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element();
        let generation = 1;
        const fetch = vi.fn(async (url: string, options?: { method: string }) => {
            if (url === "/api/developer/bot-shop/refresh" && options?.method === "POST") {
                generation++;
                return { ok: true, json: async () => ({ ok: true }) };
            }
            if (url === "/api/bot-shop") return { ok: true, json: async () => ({
                generation: String(generation), nextRefreshAt: "2030-01-01T00:00:00Z",
                items: [{ key: "berries", name: `Stock ${generation}`, rarity: "Common", category: "Consumable", description: "", basePrice: 4, price: 20, quantity: 1 }],
            }) };
            if (url.startsWith("/api/bot-shop/history")) return { ok: true, json: async () => ({ entries: [], soldOut: [], hasMore: false }) };
            if (url.endsWith("/account")) return { ok: true, json: async () => ({ claims: [], notifications: [] }) };
            if (url.endsWith("/inventory")) return { ok: true, json: async () => ({ assets: [] }) };
            return { ok: true, json: async () => ({ auctions: [], hasMore: false }) };
        });
        const confirm = vi.fn(() => true);
        const context = createContext({
            document: { querySelector: node, activeElement: null },
            window: { setInterval: vi.fn(), addEventListener: vi.fn(), confirm },
            location: { hash: "#bot-shop" }, authReady: Promise.resolve({ user: { id: "developer" }, isDeveloper: true }), fetch, encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/store.js", "utf8"), context);
        await vi.waitFor(() => expect(node("#botShopListings").innerHTML).toContain("Stock 1"));
        node("#refreshBotShop").listeners.click({ currentTarget: node("#refreshBotShop") });
        await vi.waitFor(() => expect(node("#botShopRestockStatus").textContent).toBe("Bot Shop restocked."));
        expect(fetch).toHaveBeenCalledWith("/api/developer/bot-shop/refresh", {
            method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: "{}",
        });
        expect(node("#botShopListings").innerHTML).toContain("Stock 2");
        expect(fetch.mock.calls.filter(([url]) => url.startsWith("/api/bot-shop/history"))).toHaveLength(2);
        expect(node("#refreshBotShop").disabled).toBe(false);
        confirm.mockReturnValue(false);
        node("#refreshBotShop").listeners.click({ currentTarget: node("#refreshBotShop") });
        expect(generation).toBe(2);
    });

    test("reports a failed restock and re-enables its button", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element();
        const context = createContext({
            document: { querySelector: node, activeElement: null },
            window: { setInterval: vi.fn(), addEventListener: vi.fn(), confirm: () => true },
            location: { hash: "" }, authReady: Promise.resolve({ user: null, isDeveloper: false }), encodeURIComponent,
            fetch: vi.fn(async (url: string) => url === "/api/developer/bot-shop/refresh"
                ? { ok: false, status: 403, json: async () => ({ error: "Access denied." }) }
                : { ok: true, json: async () => ({ auctions: [], hasMore: false }) }),
        });
        runInContext(readFileSync("public/scripts/store.js", "utf8"), context);
        node("#refreshBotShop").listeners.click({ currentTarget: node("#refreshBotShop") });
        await vi.waitFor(() => expect(node("#botShopRestockStatus").textContent).toContain("Access denied."));
        expect(node("#refreshBotShop").disabled).toBe(false);
    });

    test("filters stock and renders history while preserving sold-out listings", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element();
        const responses: Record<string, object> = {
            "/api/auctions?page=0": { auctions: [], hasMore: false },
            "/api/bot-shop": { generation: "1", nextRefreshAt: "2030-01-01T00:00:00Z", items: [
                { key: "berries", name: "Wild Berries", rarity: "Common", category: "Consumable", description: "Fruit", basePrice: 4, price: 20, quantity: 3 },
                { key: "pick", name: "Iron Pick", rarity: "Rare", category: "Tool", description: "Tool", basePrice: 30, price: 100, quantity: 0 },
            ] },
            "/api/bot-shop/history?page=0": { entries: [{ player_id: "buyer", player_name: "<Buyer>", item_key: "berries", name: "Wild Berries", quantity: 2, unit_price: "15", total_price: "30", purchased_at: "2029-01-01T00:00:00Z" }], hasMore: false },
        };
        const context = createContext({
            document: { querySelector: node, activeElement: null },
            window: { setInterval: vi.fn(), addEventListener: vi.fn() },
            location: { hash: "#bot-shop" },
            authReady: Promise.resolve({ user: null }),
            fetch: vi.fn(async (url: string) => ({ ok: true, json: async () => responses[url] })),
            encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/store.js", "utf8"), context);
        await vi.waitFor(() => expect(node("#botShopListings").innerHTML).toContain("Wild Berries"));
        expect(node("#botShopListings").innerHTML).toContain("Out of stock");
        await vi.waitFor(() => expect(node("#shopHistoryPurchases").innerHTML).toContain("$30"));
        expect(node("#shopHistoryPurchases").innerHTML).toContain("2 × $15");
        expect(node("#shopHistoryPurchases").innerHTML).toContain("&lt;Buyer&gt;");
        expect(node("#shopHistoryPurchases").innerHTML).toContain("/leaderboard?id=buyer");
        expect(readFileSync("public/store.html", "utf8")).not.toContain("Recently sold out");
        node("#shopSearch").value = "wild";
        node("#shopSearch").listeners.input();
        expect(node("#botShopListings").innerHTML).toContain("Wild Berries");
        expect(node("#botShopListings").innerHTML).not.toContain("Iron Pick");
        node("#shopSearch").value = "";
        node("#shopRarity").value = "Rare";
        node("#shopType").value = "Tool";
        node("#shopRarity").listeners.input();
        expect(node("#botShopListings").innerHTML).toContain("Iron Pick");
        expect(node("#botShopListings").innerHTML).not.toContain("Wild Berries");
        node("#shopType").value = "Material";
        node("#shopType").listeners.input();
        expect(node("#botShopListings").innerHTML).toContain("No items match");
    });
});
