import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

function createPage(fetch: ReturnType<typeof vi.fn>, user: { id: string } | null) {
    const nodes = new Map<string, {
        innerHTML: string; textContent: string; href: string; value: string;
        src: string; contentWindow: object; style: { width: string; height: string }; setAttribute: ReturnType<typeof vi.fn>;
        focus: ReturnType<typeof vi.fn>; tabIndex: number;
        classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> };
        addEventListener: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn>; querySelectorAll: ReturnType<typeof vi.fn>;
    }>();
    const getNode = (selector: string) => {
        if (!nodes.has(selector)) nodes.set(selector, {
            innerHTML: "", textContent: "", href: "", value: "",
            src: "", contentWindow: {}, style: { width: "", height: "" }, setAttribute: vi.fn(), focus: vi.fn(), tabIndex: 0,
            classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => true) },
            addEventListener: vi.fn(), querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => []),
        });
        return nodes.get(selector)!;
    };
    const context = createContext({
        document: { querySelector: getNode, querySelectorAll: () => [] },
        window: { addEventListener: vi.fn(), scrollTo: vi.fn(), innerHeight: 800, setTimeout: vi.fn(), clearTimeout: vi.fn() },
        location: { search: "", origin: "https://ledger.example" }, URLSearchParams, encodeURIComponent,
        localStorage: { getItem: () => null, setItem: vi.fn() },
        authReady: Promise.resolve({ user }), setNavCurrent: vi.fn(), fetch, console,
    });
    runInContext(readFileSync("public/scripts/main.js", "utf8"), context);
    return { context, getNode };
}

const response = (data: object, ok = true, status = 200) => ({ ok, status, json: async () => data });

describe("profile collections", () => {
    test("resizes the embedded skill tree only for trusted frame messages", () => {
        const { context, getNode } = createPage(vi.fn().mockResolvedValue(response([])), null);
        const listener = context.window.addEventListener.mock.calls.find((call: unknown[]) => call[0] === "message")[1];
        const frame = getNode("#profileSkillFrame");
        listener({ origin: "https://other.example", source: frame.contentWindow, data: { type: "skill-tree-height", height: 1300 } });
        listener({ origin: "https://ledger.example", source: {}, data: { type: "skill-tree-height", height: 1300 } });
        expect(frame.style.height).toBe("");
        listener({ origin: "https://ledger.example", source: frame.contentWindow, data: { type: "skill-tree-height", height: 1300.5 } });
        expect(frame.style.height).toBe("1301px");
    });

    test("shows Discord identity and saves a name only on the owner's profile", async () => {
        const fetch = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
            if (url === "/api/players") return response([{ id: "me", name: "Old" }]);
            if (url === "/api/players/me/name" && options?.method === "PUT") {
                expect(JSON.parse(options.body!)).toEqual({ name: "New name" });
                return response({ name: "New name" });
            }
            if (url === "/api/players/me") return response({
                id: "me", name: "Old", experience: 25, requiredXP: 100,
                discord: { username: "discorduser", avatarUrl: "https://cdn.discordapp.com/avatar.png" },
            });
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/me") return response({
                items: [], backpack: { name: "Pouch", used: 0, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 }, equippedTools: [], bonuses: [], toolSlots: 1,
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        expect(getNode("#profileUsername").textContent).toBe("@discorduser");
        expect(getNode("#profileAvatar").src).toBe("https://cdn.discordapp.com/avatar.png");
        expect(getNode("#profileProgressFill").style.width).toBe("25%");
        expect(getNode("#profileProgressLevel").textContent).toBe("Prestige 0 · Level 1");
        expect(getNode("#profileNameForm").classList.remove).toHaveBeenCalledWith("hidden");
        getNode("#profileNameInput").value = "New name";
        context.nameEvent = { preventDefault: vi.fn() };
        await runInContext("saveProfileName(nameEvent)", context);
        expect(getNode("#profileName").textContent).toBe("New name");
        expect(getNode("#profileNameStatus").textContent).toBe("Name saved.");
        expect(runInContext("allPlayers[0].name", context)).toBe("New name");
    });

    test("preserves every overview value in its appropriate group", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({
                id: "me", name: "Player", balance: 1234, skillPoints: 7, companionSlots: 2, toolSlots: 3,
                experienceMultiplier: 1.5, balanceMultiplier: 2, prestigeExperienceFlat: 9, prestigeBalanceFlat: 10,
                profileBonuses: { messageRewards: { experience: { multiplier: 1.75, additiveBonus: { min: 29, max: 30 } }, balance: { multiplier: 2.5, additiveBonus: { min: 80, max: 80 } } } },
                prestigeCompanionSpawnMultiplier: 1.2, prestigeCompanionRarityMultiplier: 1.3,
                scavengeWeightMultiplier: 1.4, scavengeRarityMultiplier: 1.6, scavengeExtraFindChance: 0.17,
            });
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/me") return response({
                items: [], backpack: { name: "Pouch", used: 0, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 }, equippedTools: [], bonuses: [], toolSlots: 3,
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await runInContext('loadProfile("me")', context);
        const html = getNode("#statGrid").innerHTML;
        const expected = [
            ["Balance", "$1,234"], ["Skill points", "7"], ["Companion slots", "2"], ["Tool slots", "3"],
            ["Experience multiplier", "1.75× base"], ["Money multiplier", "2.5× base"],
            ["Bonus XP", "+29–+30"], ["Bonus money", "+$80"],
            ["Prestige appearance multiplier", "1.2×"], ["Prestige rarity multiplier", "1.3×"],
            ["Scavenge item bonus", "1.4×"], ["Rare-find bonus", "1.6×"], ["Extra item chance", "17%"],
        ];
        for (const [label, value] of expected) expect(html).toContain(`${label}</dt><dd>${value}</dd>`);
        expect(html.match(/class="overview-group"/g)).toHaveLength(4);
        expect(html.match(/class="overview-stat-icon"/g)).toHaveLength(13);
    });

    test("shows each active temporary effect accurately and removes it on expiry", async () => {
        const now = Date.now();
        const types = ["scavengeRarity", "extraFindChance", "lootboxDrop", "lootboxRarity", "lootboxReward", "lootboxFind"];
        const bonuses = types.map(type => ({ type, multiplier: type === "extraFindChance" ? 0.1 : 1.5, expiresAt: new Date(now + 60000).toISOString() }));
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({ id: "me", name: "Me", profileBonuses: {
                prestige: [{ name: "Prestige XP", description: "Adds 3 XP" }],
                skills: [{ name: "Experience Gain I", description: "Adds 10 XP" }],
                companions: [{ name: "Sparkit", description: "Adds 4 XP" }],
                messageRewards: { experience: { multiplier: 1, additiveBonus: { min: 17, max: 17 } },
                    balance: { multiplier: 1, additiveBonus: { min: 0, max: 0 } } },
            } });
            if (url === "/api/companions/player/me") return response({ companions: [] });
            if (url === "/api/items/player/me") return response({
                items: [], backpack: { name: "Pouch", used: 0, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 }, equippedTools: [{ name: "Iron Pick", description: "1.5× chance weight for Material items" }], bonuses, toolSlots: 1,
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await runInContext('loadProfile("me")', context);
        runInContext('selectProfileTab("boosts")', context);
        await vi.waitFor(() => expect(getNode("#profileBoosts").innerHTML).toContain("Treasure recovery"));
        const html = getNode("#profileBoosts").innerHTML;
        for (const text of ["Rare-or-better", "10 percentage points", "capped at 75%", "drop chance",
            "higher-rarity weighting per tier for lootboxes", "higher-rarity weighting per tier for lootbox items and companions",
            "relative to boosts", "Expires"]) expect(html).toContain(text);
        for (const text of ["Prestige XP", "Experience Gain I", "Sparkit", "Iron Pick", "Material items"]) expect(html).toContain(text);
        expect(html.match(/class="boost-card"/g)).toHaveLength(10);
        expect(getNode("#profileItemBonuses").textContent).toContain("Boosts tab");
        const expiryCallback = context.window.setTimeout.mock.calls.at(-1)[0];
        runInContext(`Date.now = () => ${now + 61000}`, context);
        expiryCallback();
        expect(getNode("#profileBoosts").innerHTML).toContain("No temporary boosts are active");
        expect(getNode("#profileBoosts").innerHTML).toContain("Experience Gain I");
    });

    test("boost refresh reports errors and ignores responses for another profile", async () => {
        let resolveOld!: (value: ReturnType<typeof response>) => void;
        const old = new Promise<ReturnType<typeof response>>(resolve => { resolveOld = resolve; });
        let delayed = false;
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url.startsWith("/api/players/")) return response({ id: url.split("/").at(-1), name: "Player" });
            if (url.startsWith("/api/companions/player/")) return response({ companions: [] });
            if (url === "/api/items/player/other" && delayed) return old;
            if (url === "/api/items/player/me" && delayed) return response({}, false, 503);
            if (url.startsWith("/api/items/player/")) return response({
                items: [], backpack: { name: "Pouch", used: 0, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 }, equippedTools: [], bonuses: [], toolSlots: 1,
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await runInContext('loadProfile("other")', context);
        delayed = true;
        const pending = runInContext('loadProfileBoosts("other")', context) as Promise<void>;
        delayed = false;
        await runInContext('loadProfile("me")', context);
        delayed = true;
        await runInContext('loadProfileBoosts("me")', context);
        expect(getNode("#profileBoosts").textContent).toContain("503");
        resolveOld(response({ bonuses: [{ type: "lootboxDrop", multiplier: 2, expiresAt: new Date(Date.now() + 60000).toISOString() }] }));
        await pending;
        expect(getNode("#profileBoosts").textContent).toContain("503");
    });

    test("labels unfamiliar boost effects without injecting markup", () => {
        const { context, getNode } = createPage(vi.fn().mockResolvedValue(response([])), null);
        runInContext(`renderProfileBoosts([{ type: "<script>", multiplier: 2, expiresAt: "invalid" }])`, context);
        expect(getNode("#profileBoosts").innerHTML).toContain("Unknown boost");
        expect(getNode("#profileBoosts").innerHTML).toContain("&lt;script&gt;");
        expect(getNode("#profileBoosts").innerHTML).toContain("Expiry unavailable");
    });

    test("switches tabs, embeds the correct skill tree, and hides settings for other profiles", async () => {
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url.startsWith("/api/players/")) return response({
                id: url.split("/").at(-1), name: "Player", prestige: 2, level: 13, experience: 395, requiredXP: 974,
            });
            if (url.startsWith("/api/companions/player/")) return response({ companions: [] });
            if (url.startsWith("/api/items/player/")) return response({
                items: [], backpack: { name: "Pouch", used: 0, capacity: 10 },
                lootboxes: { boxes: 0, boosts: 0 }, equippedTools: [], bonuses: [], toolSlots: 1,
            });
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("me")', context);
        expect(getNode("#profileProgressLevel").textContent).toBe("Prestige 2 · Level 13");
        expect(getNode("#profileProgressText").textContent).toBe("395 / 974 XP");
        const overview = getNode("#statGrid").innerHTML;
        for (const label of [
            "Resources", "Message rewards", "Companion bonuses", "Scavenging bonuses", "Balance", "Skill points",
            "Experience multiplier", "Money multiplier", "Bonus XP", "Bonus money",
            "Prestige appearance multiplier", "Prestige rarity multiplier", "Companion slots", "Tool slots",
            "Scavenge item bonus", "Rare-find bonus", "Extra item chance",
        ]) expect(overview).toContain(label);
        expect(getNode("#statGrid").innerHTML).not.toContain("<label>Prestige</label>");
        expect(getNode("#statGrid").innerHTML).not.toContain("<label>Level</label>");
        expect(getNode("#statGrid").innerHTML).not.toContain("<label>Experience</label>");
        expect(getNode("#profileTab-settings").classList.remove).toHaveBeenCalledWith("hidden");

        const frameLoad = getNode("#profileSkillFrame").addEventListener.mock.calls.find(call => call[0] === "load")?.[1];
        const postMessage = vi.fn();
        getNode("#profileSkillFrame").contentWindow = { postMessage };
        context.document.documentElement = { dataset: { theme: "light" } };
        frameLoad();
        expect(postMessage).toHaveBeenCalledWith({ type: "ledger-theme", theme: "light" }, "https://ledger.example");

        const keydown = getNode("#profileTab-overview").addEventListener.mock.calls.find(call => call[0] === "keydown")?.[1];
        const keyEvent = { key: "ArrowRight", preventDefault: vi.fn() };
        keydown(keyEvent);
        expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
        expect(getNode("#profileTab-companions").focus).toHaveBeenCalledOnce();
        expect(getNode("#profileTab-companions").tabIndex).toBe(0);
        expect(getNode("#profileTab-overview").tabIndex).toBe(-1);
        runInContext('selectProfileTab("skills")', context);
        expect(getNode("#profileSkillFrame").src).toBe("/skills?embed=1");
        expect(getNode("#profilePanel-skills").classList.toggle).toHaveBeenLastCalledWith("hidden", false);
        expect(getNode("#profileTab-skills").setAttribute).toHaveBeenLastCalledWith("aria-selected", "true");
        runInContext('selectProfileTab("items")', context);
        await vi.waitFor(() => expect(fetch.mock.calls.some(call => call[0] === "/api/players/me" && call[1]?.cache === "no-store")).toBe(true));
        expect(getNode("#profilePanel-items").classList.toggle).toHaveBeenLastCalledWith("hidden", false);

        await runInContext('loadProfile("other")', context);
        expect(getNode("#profileTab-settings").classList.add).toHaveBeenCalledWith("hidden");
        runInContext('selectProfileTab("settings")', context);
        expect(runInContext("profileTab", context)).toBe("overview");
        runInContext('selectProfileTab("skills")', context);
        expect(getNode("#profileSkillFrame").src).toBe("/skills?embed=1&player=other");
        expect(getNode("#openSkillTree").href).toBe("/skills?player=other");
    });

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
            if (url === "/api/players/other") return response({ id: "other", name: "Other", balance: 0, experience: 1234, requiredXP: 5678 });
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
        expect(getNode("#profileProgressText").textContent).toBe("1,234 / 5,678 XP");
        expect(getNode("#statGrid").innerHTML).not.toContain("1,234/5,678 XP");
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
