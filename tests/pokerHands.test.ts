import { describe, expect, test } from "vitest";
import { bestHand, compareScores, currentHandName, estimatePokerEquity, showdownWinners, type PokerCard } from "../src/pokerHands.js";

const card = (rank: string, suit: string): PokerCard => ({ rank, suit });

describe("poker hand and equity calculations", () => {
    test("labels current hands before and after the flop", () => {
        expect(currentHandName([])).toBeNull();
        expect(currentHandName([card("A", "♠"), card("K", "♥")])).toBe("High card");
        expect(currentHandName([card("A", "♠"), card("A", "♥")])).toBe("Pair");
        expect(currentHandName([card("A", "♠"), card("A", "♥"), card("K", "♠"), card("K", "♥")])).toBe("Two pair");
        expect(currentHandName([card("A", "♠"), card("2", "♠"), card("3", "♠"), card("4", "♠"), card("5", "♠"), card("K", "♥")])).toBe("Straight flush");
        expect(compareScores(bestHand([card("A", "♠"), card("2", "♠"), card("3", "♠"), card("4", "♠"), card("5", "♠")]),
            bestHand([card("2", "♥"), card("3", "♥"), card("4", "♥"), card("5", "♥"), card("6", "♥")]))).toBeLessThan(0);
    });

    test("showdown and equity split ties and exclude folded players", () => {
        const board = ["10", "J", "Q", "K", "A"].map(rank => card(rank, "♠"));
        const players = [
            { id: "one", hole: [card("2", "♥"), card("3", "♥")], folded: false },
            { id: "two", hole: [card("4", "♥"), card("5", "♥")], folded: false },
            { id: "folded", hole: [card("6", "♥"), card("7", "♥")], folded: true },
        ];
        expect(showdownWinners(players, board)).toEqual(["one", "two"]);
        expect(estimatePokerEquity(players, board)).toEqual({ one: 50, two: 50 });
    });

    test("samples remaining cards without using folded cards or duplicating a board card", () => {
        const players = [
            { id: "one", hole: [card("A", "♠"), card("A", "♥")], folded: false },
            { id: "two", hole: [card("K", "♠"), card("K", "♥")], folded: false },
            { id: "folded", hole: [card("2", "♣"), card("3", "♣")], folded: true },
        ];
        const board = [card("4", "♣"), card("5", "♣"), card("6", "♦"), card("7", "♦")];
        const rollSizes: number[] = [];
        const equity = estimatePokerEquity(players, board, 10, max => { rollSizes.push(max); return 0; });
        expect(rollSizes).toEqual(Array(10).fill(42));
        expect(equity.one + equity.two).toBe(100);
        expect(equity).not.toHaveProperty("folded");
    });

    test("gives the stronger hand full equity on a complete board", () => {
        const players = [
            { id: "aces", hole: [card("A", "♠"), card("A", "♥")], folded: false },
            { id: "kings", hole: [card("K", "♠"), card("K", "♥")], folded: false },
        ];
        const board = [card("2", "♣"), card("5", "♦"), card("7", "♥"), card("9", "♣"), card("J", "♠")];
        expect(showdownWinners(players, board)).toEqual(["aces"]);
        expect(estimatePokerEquity(players, board)).toEqual({ aces: 100, kings: 0 });
    });
});
