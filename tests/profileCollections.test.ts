import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

function createPage(fetch: ReturnType<typeof vi.fn>, user: { id: string } | null) {
    const nodes = new Map<string, {
        innerHTML: string; textContent: string; href: string; value: string;
        classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn>; contains: ReturnType<typeof vi.fn> };
        addEventListener: ReturnType<typeof vi.fn>; querySelector: ReturnType<typeof vi.fn>;
    }>();
    const getNode = (selector: string) => {
        if (!nodes.has(selector)) nodes.set(selector, {
            innerHTML: "", textContent: "", href: "", value: "",
            classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => true) },
            addEventListener: vi.fn(), querySelector: vi.fn(() => null),
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
            throw new Error(`Unexpected request: ${url}`);
        });
        const { context, getNode } = createPage(fetch, { id: "me" });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/players"));
        await runInContext('loadProfile("other")', context);
        expect(getNode("#openSkillTree").href).toBe("/skills?player=other");
        expect(getNode("#openSkillTree").textContent).toBe("View skill tree");
        expect(getNode("#profileCompanions").innerHTML).toContain('/companion?key=mossprout');
        expect(getNode("#profileCompanions").innerHTML).toContain("Mossprout</a> · Common · 3 owned · Equipped");
        expect(getNode("#profileCompanions").innerHTML).toContain("&lt;old&gt; (retired)");
        expect(getNode("#profileCompanions").innerHTML).not.toContain("<old>");
    });

    test("own profile links to editable tree and reports empty inventory or load failures", async () => {
        let failed = false;
        const fetch = vi.fn(async (url: string) => {
            if (url === "/api/players") return response([]);
            if (url === "/api/players/me") return response({ id: "me", name: "Me", balance: 0 });
            if (url === "/api/companions/player/me") return failed
                ? response({}, false, 503) : response({ companions: [] });
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
