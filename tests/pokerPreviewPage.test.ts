import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    children: (Element | string)[] = [];
    constructor(public tag: string, public className = "", public textContent = "") {}
    append(...children: (Element | string)[]) { this.children.push(...children); }
}

describe("poker developer preview page", () => {
    test("renders upcoming community and revealed opponent cards only when supplied by the server", () => {
        const source = readFileSync("public/scripts/lobbies.js", "utf8");
        const render = source.slice(source.indexOf("  function renderPoker("), source.indexOf("  function actionControls("));
        const decorate = vi.fn((node: Element) => node);
        const context = createContext({
            el: (tag: string, className = "", text = "") => new Element(tag, className, text),
            cardElement: (card: { rank: string; suit: string }) => new Element("card", "", `${card.rank}${card.suit}`),
            emptyCard: () => new Element("empty"), backCard: () => new Element("back"),
            dealer: { decorate },
            format: (amount: number) => `$${amount}`, STAGES: { preflop: "Pre-flop" },
            sound: { card() {} },
        });
        runInContext(`${render}\nthis.renderPoker = renderPoker;`, context);
        const poker = {
            stage: "preflop", handNo: 1, pot: 20, sb: 5, bb: 10, community: [],
            active: true, turnId: "opponent", result: null,
            seats: [
                { id: "developer", name: "Me", hole: [], chips: 200, inHand: false, currentHand: "Pair", equity: 30 },
                { id: "opponent", name: "Other", hole: [{ rank: "A", suit: "♠" }], chips: 200, inHand: true, currentHand: "High card", equity: 70 },
            ],
            upcomingCommunity: [{ rank: "K", suit: "♥" }, { rank: "3", suit: "♣" }],
            predictedWinners: ["opponent"],
        };
        const lobby = { poker, you: "developer", status: "playing" };
        const shown: Element[] = context.renderPoker(lobby, null);
        expect(shown[0].children.some(child => child instanceof Element && child.textContent.includes("K♥ 3♣"))).toBe(true);
        const opponent = shown[1].children[1] as Element;
        const cards = opponent.children.find(child => child instanceof Element && child.className.includes("poker-hole")) as Element;
        expect((cards.children[0] as Element).textContent).toBe("A♠");
        expect(decorate).toHaveBeenCalledWith(expect.any(Element), "hole:opponent:0");
        expect(opponent.children.some(child => child instanceof Element && child.textContent === "Current hand: High card")).toBe(true);
        expect(opponent.children.some(child => child instanceof Element && child.textContent === "Estimated equity: 70.0%")).toBe(true);
        expect(shown[0].children.some(child => child instanceof Element && child.textContent.includes("showdown") && child.textContent.includes("Other"))).toBe(true);
        const hidden: Element[] = context.renderPoker({
            ...lobby, poker: { ...poker, upcomingCommunity: undefined, seats: [
                { ...poker.seats[0], equity: undefined }, { ...poker.seats[1], hole: [], currentHand: undefined, equity: undefined },
            ] },
        }, null);
        expect(hidden[0].children.some(child => child instanceof Element && child.textContent.includes("Developer view"))).toBe(false);
        const hiddenOpponent = hidden[1].children[1] as Element;
        const hiddenCards = hiddenOpponent.children.find(child => child instanceof Element && child.className.includes("poker-hole")) as Element;
        expect(hiddenCards.children.map(child => (child as Element).tag)).toEqual(["back", "back"]);
    });
});
