import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    textContent = "";
    value = "10";
    className = "";
    innerHTML = "";
    disabled = false;
    style: Record<string, string> = {};
    listeners: Record<string, () => unknown> = {};
    children: Element[] = [];
    classList = {
        toggle: vi.fn(), add: vi.fn(), remove: vi.fn(),
    };
    addEventListener(event: string, handler: () => unknown) { this.listeners[event] = handler; }
    replaceChildren(...children: Element[]) { this.children = children; }
    querySelectorAll() { return [new Element(), new Element()]; }
    querySelector() { return new Element(); }
}

describe("blackjack preview display", () => {
    test("shows the server-provided preview, updates after a hit and clears when the round ends", async () => {
        const nodes: Record<string, Element> = {};
        const node = (selector: string) => nodes[selector] ??= new Element();
        const card = (rank: string, suit = "♠") => ({ rank, suit });
        const active = {
            active: true, player: [card("5"), card("6")], dealer: [card("4")],
            dealerHidden: true, playerTotal: 11, dealerTotal: 4, bet: 10, balance: 100,
            canDouble: true, casinoPayoutMultiplier: 1,
        };
        const odds = { win: 50, push: 10, loss: 40, expectedNet: 1 };
        const api = vi.fn().mockResolvedValueOnce({ ...active, dealer: [card("4"), card("10")], dealerHidden: false, dealerTotal: 14, nextCard: card("3", "♥"),
            advice: { recommended: "hit", stand: odds, hit: odds, double: null } })
            .mockResolvedValueOnce({ ...active, player: [...active.player, card("3", "♥")], nextCard: card("7", "♦") })
            .mockResolvedValueOnce({ ...active, active: false, dealerHidden: false, dealer: [card("4"), card("10")],
                outcome: "win", payout: 20 });
        const context = createContext({
            $: node, document: { querySelectorAll: () => [], createElement: () => new Element() },
            window: {}, sound: { card: vi.fn(), chip: vi.fn(), win: vi.fn(), lose: vi.fn(), push: vi.fn() },
            setTimeout: vi.fn(), setCasinoPayoutMultiplier: vi.fn(), setBalance: vi.fn(),
            selectGame: vi.fn(), format: (value: number) => `$${value}`, api,
        });
        const script = readFileSync("public/scripts/casino.js", "utf8");
        runInContext(script.slice(script.indexOf("// Blackjack\n"), script.indexOf("// Pass the Bills\n")), context);
        await context.window.resumeBlackjack();
        expect(node("#bjNextCard").classList.toggle).toHaveBeenLastCalledWith("hidden", false);
        expect(node("#bjNextCard").textContent).toContain("3♥");
        expect(node("#bjAdvice").textContent).toContain("Best expected net: HIT");
        expect(node("#bjAdvice").textContent).toContain("Hit once, then stand");
        expect(node("#bjAdvice").textContent).toContain("Double: unavailable");
        expect(node("#bjDealer").children).toHaveLength(2);
        expect(node("#bjDealer").children[1].className).not.toContain("back");
        expect(node("#bjDealerTotal").textContent).toBe(14);
        await node("#bjHit").listeners.click();
        expect(node("#bjNextCard").textContent).toContain("7♦");
        expect(node("#bjAdvice").textContent).toBe("");
        expect(node("#bjDealer").children[1].className).toContain("back");
        await node("#bjStand").listeners.click();
        expect(node("#bjNextCard").classList.toggle).toHaveBeenLastCalledWith("hidden", true);
        expect(node("#bjNextCard").textContent).toBe("");
        expect(node("#bjAdvice").classList.toggle).toHaveBeenLastCalledWith("hidden", true);
    });

    test("the preview starts hidden in the page markup", () => {
        expect(readFileSync("public/casino.html", "utf8")).toMatch(/id="bjNextCard" class="[^"]*hidden/);
    });
});
