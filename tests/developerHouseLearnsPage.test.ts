import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    className = "";
    textContent = "";
    value = "";
    type = "";
    children: Element[] = [];
    handlers: Record<string, (event: { preventDefault(): void }) => void> = {};
    classList = { add: vi.fn(), toggle: vi.fn() };
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    addEventListener(event: string, handler: (event: { preventDefault(): void }) => void) { this.handlers[event] = handler; }
}

describe("House Learns developer diagnostics", () => {
    test("searches, paginates, and shows safe player and strategy details", async () => {
        const nodes = new Map<string, Element>();
        const node = (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, new Element());
            return nodes.get(selector)!;
        };
        const fetch = vi.fn(async (url: string) => {
            if (url.includes("/players/")) return { ok: true, json: async () => ({
                id: "123", name: "<img>", player: { actions: 10, raises: 4, calls: 4, folds: 2 },
                global: { actions: 100, raises: 30, calls: 50, folds: 20 },
                tactics: { aggression: 0.3, foldRate: 0.2, foldAdjustment: 0.036, bluffChance: 0.08 },
            }) };
            if (url.includes("after=")) return { ok: true, json: async () => ({ players: [{ id: "456", name: "Other", learned: false }], next: null }) };
            return { ok: true, json: async () => ({ players: [{ id: "123", name: "<img>", learned: true }], next: "123" }) };
        });
        const context = createContext({
            document: { querySelector: node, createElement: () => new Element() },
            fetch, URLSearchParams, encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/developerHouseLearns.js", "utf8"), context);
        await vi.waitFor(() => expect(node("#houseLearnPlayers").children).toHaveLength(1));
        node("#houseLearnPlayers").children[0].handlers.click({ preventDefault() {} });
        await vi.waitFor(() => expect(node("#houseLearnDetails").children).toHaveLength(1));
        const children = node("#houseLearnDetails").children[0].children;
        expect(children[0].textContent).toBe("<img> (123)");
        expect(children[0].children).toHaveLength(0);
        expect(children[2].textContent).toContain("4 calls/checks (40.0%)");
        expect(children[4].textContent).toContain("100 actions");
        expect(children[6].textContent).toContain("3.60%");
        expect(children[7].textContent).toContain("8.00%");
        node("#houseLearnMore").handlers.click({ preventDefault() {} });
        await vi.waitFor(() => expect(node("#houseLearnPlayers").children).toHaveLength(2));
        expect(node("#houseLearnPlayers").children[1].textContent).toContain("no observations");
        node("#houseLearnQuery").value = "alice";
        node("#houseLearnSearch").handlers.submit({ preventDefault() {} });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
            "/api/developer/house-learns/players?search=alice", { cache: "no-store" },
        ));
    });

    test("shows search errors instead of stale results", async () => {
        const nodes = new Map<string, Element>();
        const node = (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, new Element());
            return nodes.get(selector)!;
        };
        const context = createContext({
            document: { querySelector: node, createElement: () => new Element() },
            fetch: vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Database unavailable." }) }),
            URLSearchParams, encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/developerHouseLearns.js", "utf8"), context);
        await vi.waitFor(() => expect(node("#houseLearnStatus").textContent).toContain("Database unavailable."));
        expect(node("#houseLearnPlayers").children).toHaveLength(0);
    });
});
