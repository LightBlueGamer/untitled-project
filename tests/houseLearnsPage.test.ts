import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    className = "";
    textContent = "";
    value = "";
    children: Element[] = [];
    attributes: Record<string, string> = {};
    listeners: Record<string, () => unknown> = {};
    style: Record<string, string> = {};
    classList = { toggle: vi.fn(), add: vi.fn(), contains: vi.fn().mockReturnValue(false) };
    constructor(public tag: string) {}
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    addEventListener(event: string, listener: () => unknown) { this.listeners[event] = listener; }
}

function find(node: Element, className: string): Element {
    if (node.className.split(" ").includes(className)) return node;
    for (const child of node.children) {
        const found = findOptional(child, className);
        if (found) return found;
    }
    throw new Error(`Missing ${className}`);
}

function findOptional(node: Element, className: string): Element | undefined {
    if (node.className.split(" ").includes(className)) return node;
    for (const child of node.children) {
        const found = findOptional(child, className);
        if (found) return found;
    }
    return undefined;
}

describe("House Learns poker display", () => {
    test("renders the shared poker table, hidden and revealed cards, and working controls", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element("div");
        const game = {
            hand: 1, stage: "preflop", blind: 20, board: [], pot: 30,
            player: { chips: 90, bet: 10, hole: [{ rank: "A", suit: "♠" }, { rank: "Q", suit: "♥" }], currentHand: "High card" },
            bot: { chips: 80, bet: 20, hole: [] }, toCall: 10, minRaiseTo: 40, maxRaiseTo: 100, message: "Your turn.",
            winner: null as string | null,
        };
        const match = { id: "match", revision: 3, status: "active", deadline: "2099-01-01", payout: "0", unclaimed: "0", reason: "Tournament completed.", game };
        const stats = { pool: "100", games: "3", houseWins: "2" };
        const api = vi.fn().mockResolvedValue({ match, stats });
        const window = { clearTimeout: vi.fn(), setTimeout: vi.fn(), matchMedia: () => ({ matches: false }), confirm: vi.fn().mockReturnValue(true) };
        const context = createContext({
            $: node, window, document: { createElement: (tag: string) => new Element(tag) },
            setTimeout: vi.fn(), format: (value: number) => `$${value}`, api, refreshBalance: vi.fn(), sound: { card: vi.fn() },
        });
        runInContext(readFileSync("public/scripts/pokerCards.js", "utf8"), context);
        runInContext(readFileSync("public/scripts/houseLearns.js", "utf8"), context);
        await context.window.refreshHouseLearns();
        const room = node("#houseRoom");
        expect(find(room, "poker-table")).toBeTruthy();
        expect(find(room, "poker-community").children.map(card => card.className)).toEqual(Array(5).fill("bj-card empty"));
        const seats = find(room, "house-poker-seats");
        const botCards = find(seats.children[0], "poker-hole");
        expect(botCards.children.map(card => card.className)).toEqual(["bj-card back", "bj-card back"]);
        expect(find(seats.children[1], "poker-hole").children[1].className).toBe("bj-card red");
        const actions = find(room, "lobby-actions");
        expect(actions.children.map(child => child.textContent)).toContain("Call $10");
        const allIn = actions.children.find(child => child.textContent === "All-in $100");
        await allIn?.listeners.click();
        expect(api).toHaveBeenCalledWith("/house-learns/match/action", expect.objectContaining({
            body: JSON.stringify({ action: "raise", amount: 100, revision: 3 }),
        }));

        match.game = { ...game, stage: "between", board: [{ rank: "2", suit: "♦" }], bot: { ...game.bot, hole: [{ rank: "K", suit: "♦" }, { rank: "J", suit: "♣" }] } };
        await context.window.refreshHouseLearns();
        expect(find(find(room, "house-poker-seats").children[0], "poker-hole").children[0].className).toBe("bj-card red");
        expect(find(room, "poker-community").children[0].attributes["aria-label"]).toBe("2 ♦");
        const next = find(room, "lobby-actions").children.find(child => child.textContent === "Next hand");
        await next?.listeners.click();
        expect(api).toHaveBeenCalledWith("/house-learns/match/action", expect.objectContaining({
            body: JSON.stringify({ action: "next", revision: 3 }),
        }));

        match.status = "house";
        match.game = { ...match.game, stage: "finished", winner: "house" };
        await context.window.refreshHouseLearns();
        expect(findOptional(room, "lobby-actions")).toBeUndefined();
        expect(node("#houseStatus").textContent).toBe("");
        expect(find(room, "house-poker-seats").children[0].className).toContain("winner");
    });

    test("loads shared card rendering before both poker modes", () => {
        const html = readFileSync("public/casino.html", "utf8");
        expect(html.indexOf("/scripts/pokerCards.js")).toBeGreaterThan(-1);
        expect(html.indexOf("/scripts/pokerCards.js")).toBeLessThan(html.indexOf("/scripts/lobbies.js"));
        expect(html.indexOf("/scripts/pokerCards.js")).toBeLessThan(html.indexOf("/scripts/houseLearns.js"));
    });

    test("estimates pool prizes for different wagers and reports stale-pool uncertainty", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element("div");
        const api = vi.fn().mockResolvedValue({ match: null, stats: { pool: "100000000000", games: "0", houseWins: "0" } });
        const context = createContext({
            $: node, window: { clearTimeout: vi.fn(), setTimeout: vi.fn(), matchMedia: () => ({ matches: false }) },
            document: { createElement: (tag: string) => new Element(tag) },
            setTimeout: vi.fn(), format: (value: number) => `$${value}`, api, refreshBalance: vi.fn(), sound: { card: vi.fn() },
        });
        runInContext(readFileSync("public/scripts/pokerCards.js", "utf8"), context);
        runInContext(readFileSync("public/scripts/houseLearns.js", "utf8"), context);
        node("#houseWager").value = "100";
        await context.window.refreshHouseLearns();
        expect(node("#houseEstimate").textContent).toContain("$100,000,000 from the pool plus your $100 wager");
        expect(node("#houseEstimate").textContent).toContain("may change");
        node("#houseWager").value = "37500000000";
        node("#houseWager").listeners.input();
        expect(node("#houseEstimate").textContent).toContain("$50,000,000,000 from the pool");
        node("#houseWager").value = "75000000000";
        node("#houseWager").listeners.input();
        expect(node("#houseEstimate").textContent).toContain("$100,000,000,000 from the pool");
        node("#houseWager").value = "4503599627370496";
        node("#houseWager").listeners.input();
        expect(node("#houseEstimate").textContent).toContain("valid wager");
    });

    test("animates and sounds a newly started game without replaying on refresh", async () => {
        vi.useFakeTimers();
        try {
            const nodes: Record<string, Element> = {};
            const node = (selector: string) => nodes[selector] ??= new Element("div");
            const stats = { pool: "0", games: "0", houseWins: "0" };
            const game = {
                hand: 1, stage: "preflop", blind: 20, board: [], pot: 30,
                player: { chips: 90, bet: 10, hole: [{ rank: "A", suit: "♠" }, { rank: "Q", suit: "♥" }], currentHand: "High card" },
                bot: { chips: 80, bet: 20, hole: [] }, toCall: 10, minRaiseTo: 40, maxRaiseTo: 100, message: "Your turn.",
            };
            const match = { id: "new", revision: 0, status: "active", deadline: "2099-01-01", game };
            const api = vi.fn().mockResolvedValue({ match, stats });
            const sound = { card: vi.fn() };
            const context = createContext({
                $: node, window: { clearTimeout, setTimeout, matchMedia: () => ({ matches: false }) },
                document: { createElement: (tag: string) => new Element(tag) }, Date, setTimeout,
                format: (value: number) => `$${value}`, api, refreshBalance: vi.fn(), sound,
            });
            runInContext(readFileSync("public/scripts/pokerCards.js", "utf8"), context);
            runInContext(readFileSync("public/scripts/houseLearns.js", "utf8"), context);
            node("#houseWager").value = "100";
            await node("#housePlay").listeners.click();
            const seats = find(node("#houseRoom"), "house-poker-seats");
            const botCards = find(seats.children[0], "poker-hole").children;
            expect(botCards[0].classList.add).toHaveBeenCalledWith("poker-dealt");
            await context.window.refreshHouseLearns();
            await vi.advanceTimersByTimeAsync(500);
            expect(sound.card).toHaveBeenCalledTimes(4);
            await context.window.refreshHouseLearns();
            await vi.advanceTimersByTimeAsync(500);
            expect(sound.card).toHaveBeenCalledTimes(4);
        } finally {
            vi.useRealTimers();
        }
    });
});
