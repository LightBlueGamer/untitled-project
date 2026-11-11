import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

function createPage(fetch: ReturnType<typeof vi.fn>, user: { id: string } | null) {
    const nodes = new Map<string, {
        innerHTML: string; textContent: string; href: string; value: string;
        classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> };
        addEventListener: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn>; querySelectorAll: ReturnType<typeof vi.fn>;
    }>();
    const getNode = (selector: string) => {
        if (!nodes.has(selector)) nodes.set(selector, {
            innerHTML: "", textContent: "", href: "", value: "",
            classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => true) },
            addEventListener: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []),
        });
        return nodes.get(selector)!;
    };
    const context = createContext({
        document: { querySelector: getNode, querySelectorAll: () => [] },
        window: { addEventListener: vi.fn(), scrollTo: vi.fn(), innerHeight: 800 },
        location: { search: "" }, URLSearchParams, encodeURIComponent,
        localStorage: { getItem: () => null, setItem: vi.fn() },
        authReady: Promise.resolve({ user }), setNavCurrent: vi.fn(), fetch, console,
    });
    runInContext(readFileSync("public/scripts/main.js", "utf8"), context);
    return { context, getNode };
}

const response = (data: object, ok = true, status = 200) => ({ ok, status, json: async () => data });

describe("profile collections", () => {
    test("moves the signed-in player to the top while keeping their leaderboard rank", async () => {
        const players = [
            { id: "top", name: "Top", prestige: 5, level: 1 },
            { id: "me", name: "Me", prestige: 3, level: 1 },
            { id: "last", name: "Last", prestige: 1, level: 1 },
        ];
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response(players);
            throw new Error(`Unexpected request: ${url}`);
        });
        const { getNode } = createPage(fetch, { id: "me" });

        await vi.waitFor(() => expect(getNode("#playersBody").innerHTML).toContain('id="current-player-row"'));

        const rows = getNode("#playersBody").innerHTML.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
        expect(rows[0]).toContain("Me");
        expect(rows[0]).toContain("#2");
        expect(rows[1]).toContain("Top");
        expect(rows[2]).toContain("Last");
    });

    test("shows another player's read-only tree and named companions", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/other") return response({ id: "other", name: "Other", balance: 0 });
            if (url === "/api/companions/player/other") return response({ companions: [
                { key: "mossprout", name: "Mossprout", rarity: "Common", quantity: 3, equipped: true },
                { key: "<old>", name: null, rarity: null, quantity: 1, equipped: false },
            ] });
            if (url === "/api/items/player/other") return response({
                items: [{ key: "iron_ore", name: "Iron Ore", category: "Material", rarity: "Uncommon", quantity: 4, price: 18 }],
                equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: 4, capacity: 10 }, lootboxes: { boxes: 2, boosts: 1 },
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("other")', context);
        expect(getNode("#openSkillTree").href).toBe("/skills?player=other");
        expect(getNode("#openSkillTree").textContent).toBe("View skill tree");
        expect(getNode("#profileCompanions").innerHTML).toContain('/companion?key=mossprout');
        expect(getNode("#profileCompanions").innerHTML).toContain("Mossprout</a>");
        expect(getNode("#profileCompanions").innerHTML).toContain("3 owned · Equipped");
        expect(getNode("#profileCompanions").innerHTML).toContain("&lt;old&gt; (retired)");
        expect(getNode("#profileCompanions").innerHTML).not.toContain("<old>");
        expect(getNode("#profileItems").innerHTML).toContain('/item?key=iron_ore');
        expect(getNode("#profileItems").innerHTML).toContain("4 owned");
        expect(getNode("#profileItems").innerHTML).not.toContain("profile-sell-form");
        expect(getNode("#profileBackpack").textContent).toBe("Small Pouch: 4/10 slots used");
        expect(getNode("#profileLootboxes").textContent).toBe("Lootboxes: 2 · Unused lootbox boosts: 1");
    });

    test("own inventory has sale controls and refreshes after a successful sale", async () => {
        let sold = false;
        const fetch = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({ id: "me", name: "Me", balance: sold ? 18 : 0 });
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/me") return response({
                items: [{ key: "iron_ore", name: "Iron Ore", category: "Material", rarity: "Uncommon", quantity: sold ? 1 : 2, price: 18 }],
                equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: sold ? 1 : 2, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 },
            });
            if (url === "/api/items/sell" && options?.method === "POST") {
                expect(JSON.parse(options.body!)).toEqual({ item: "iron_ore", quantity: 1 });
                sold = true;
                return response({ item: "Iron Ore", quantity: 1, proceeds: 18, unequipped: false });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        expect(getNode("#profileItems").innerHTML).toContain('class="profile-sell-form"');
        expect(getNode("#profileItems").innerHTML).toContain("Sell for $18 each");
        const button = { disabled: false };
        const event = {
            preventDefault: vi.fn(),
            target: { matches: () => true, elements: { quantity: { value: "1", max: "2" } },
                dataset: { item: "iron_ore" }, querySelector: () => button },
        };
        context.saleEvent = event;
        await runInContext("sellProfileItem(saleEvent)", context);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(getNode("#profileSaleStatus").textContent).toContain("Sold 1 × Iron Ore for $18");
        expect(getNode("#profileItems").innerHTML).toContain("1 owned");
        expect(getNode("#profileBackpack").textContent).toContain("1/10");
        expect(getNode("#statGrid").innerHTML).toContain("$18");
    });

    test("invalid quantities and another player's profile cannot submit sales", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me" || url === "/api/players/other") return response({ id: url.split("/").at(-1), name: "Player" });
            if (url.startsWith("/api/companions/player/")) return response({ companions: [] });
            if (url.startsWith("/api/items/player/")) return response({
                items: [{ key: "iron_ore", name: "Iron Ore", rarity: "Uncommon", quantity: 2, price: 18 }],
                equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: 2, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 },
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        const event = { preventDefault: vi.fn(), target: { matches: () => true,
            elements: { quantity: { value: "2.5", max: "2" } }, dataset: { item: "iron_ore" } } };
        context.saleEvent = event;
        await runInContext("sellProfileItem(saleEvent)", context);
        expect(getNode("#profileSaleStatus").textContent).toContain("whole number");
        await runInContext('loadProfile("other")', context);
        event.target.elements.quantity.value = "1";
        await runInContext("sellProfileItem(saleEvent)", context);
        expect(fetch.mock.calls.some(call => call[0] === "/api/items/sell")).toBe(false);
    });

    test("prevents duplicate submissions and reports a rejected sale", async () => {
        let resolveSale!: (value: ReturnType<typeof response>) => void;
        const delayedSale = new Promise<ReturnType<typeof response>>(resolve => { resolveSale = resolve; });
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({ id: "me", name: "Me" });
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/me") return response({
                items: [{ key: "iron_ore", name: "Iron Ore", rarity: "Uncommon", quantity: 2, price: 18 }],
                equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: 2, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 },
            });
            if (url === "/api/items/sell") return delayedSale;
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        const button = { disabled: false };
        context.saleEvent = { preventDefault: vi.fn(), target: { matches: () => true,
            elements: { quantity: { value: "1", max: "2" } }, dataset: { item: "iron_ore" }, querySelector: () => button } };
        const first = runInContext("sellProfileItem(saleEvent)", context) as Promise<void>;
        expect(button.disabled).toBe(true);
        await runInContext("sellProfileItem(saleEvent)", context);
        expect(fetch.mock.calls.filter(call => call[0] === "/api/items/sell")).toHaveLength(1);
        resolveSale(response({ error: "You only own 0 of that item." }, false, 409));
        await first;
        expect(getNode("#profileSaleStatus").textContent).toContain("You only own 0");
        expect(getNode("#profileSaleStatus").textContent).toContain("Check your inventory");
    });

    test("own profile links to editable tree and reports empty inventory or load failures", async () => {
        let failed = false;
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({ id: "me", name: "Me", balance: 0 });
            if (url === "/api/companions/player/me") return failed
                ? response({}, false, 503) : response({ companions: [] });
            if (url === "/api/items/player/me") return response({ items: [], equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: 0, capacity: 10 }, lootboxes: { boxes: 0, boosts: 0 } });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        expect(getNode("#openSkillTree").href).toBe("/skills");
        expect(getNode("#profileCompanions").innerHTML).toContain("No companions yet");
        failed = true;
        await runInContext('loadProfile("me")', context);
        expect(getNode("#profileCompanions").textContent).toContain("503");
    });

    test("late companion responses cannot overwrite a different profile", async () => {
        let resolveOther!: (value: ReturnType<typeof response>) => void;
        const delayed = new Promise<ReturnType<typeof response>>(resolve => { resolveOther = resolve; });
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/other") return response({ id: "other", name: "Other", balance: 0 });
            if (url === "/api/players/me") return response({ id: "me", name: "Me", balance: 0 });
            if (url === "/api/companions/player/other") return delayed;
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/other" || url === "/api/items/player/me") return response({
                items: [], equippedTools: [], bonuses: [], toolSlots: 1, backpack: { name: "Small Pouch", used: 0, capacity: 10 }, lootboxes: { boxes: 0, boosts: 0 },
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        const other = runInContext('loadProfile("other")', context) as Promise<void>;
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/companions/player/other", { cache: "no-store" }));
        await runInContext('loadProfile("me")', context);
        resolveOther(response({ companions: [{ key: "mossprout", name: "Mossprout", quantity: 1 }] }));
        await other;
        expect(getNode("#profileName").textContent).toBe("Me");
        expect(getNode("#profileCompanions").innerHTML).toContain("No companions yet");
    });
});
