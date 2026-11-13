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
    classList = {
        toggle: vi.fn(), add: vi.fn(), remove: vi.fn(),
    };
    addEventListener(event: string, handler: () => unknown) { this.listeners[event] = handler; }
    replaceChildren() {}
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
        const api = vi.fn().mockResolvedValueOnce({ ...active, nextCard: card("3", "♥") })
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
        await node("#bjHit").listeners.click();
        expect(node("#bjNextCard").textContent).toContain("7♦");
        await node("#bjStand").listeners.click();
        expect(node("#bjNextCard").classList.toggle).toHaveBeenLastCalledWith("hidden", true);
        expect(node("#bjNextCard").textContent).toBe("");
    });

    test("the preview starts hidden in the page markup", () => {
        expect(readFileSync("public/casino.html", "utf8")).toMatch(/id="bjNextCard" class="[^"]*hidden/);
    });
});
