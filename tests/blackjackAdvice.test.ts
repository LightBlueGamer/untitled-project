import { describe, expect, test } from "vitest";
import { blackjackAdvice, blackjackHandValue, type BlackjackCard } from "../src/blackjackAdvice.js";

const card = (rank: string): BlackjackCard => ({ rank, suit: "♠" });

describe("blackjack action advice", () => {
    test("recommends stand when the known hit busts but the dealer must take it and bust", () => {
        const advice = blackjackAdvice({
            player: [card("10"), card("6")], dealer: [card("10"), card("6")], nextCard: card("K"),
            bet: 10, balance: 100, payoutMultiplier: 1,
        });
        expect(advice.stand).toMatchObject({ win: 100, loss: 0, expectedNet: 10 });
        expect(advice.hit).toMatchObject({ win: 0, loss: 100, expectedNet: -10 });
        expect(advice.double).toMatchObject({ win: 0, loss: 100, expectedNet: -20 });
        expect(advice.recommended).toBe("stand");
    });

    test("recommends double for a guaranteed 21 and uses rounded boosted winnings", () => {
        const input = {
            player: [card("10"), card("6")], dealer: [card("10"), card("8")], nextCard: card("5"),
            bet: 3, balance: 6, payoutMultiplier: 1.25,
        };
        const advice = blackjackAdvice(input);
        expect(advice.stand).toMatchObject({ loss: 100, expectedNet: -3 });
        expect(advice.hit).toMatchObject({ win: 100, expectedNet: 3 });
        expect(advice.double).toMatchObject({ win: 100, expectedNet: 7 });
        expect(advice.recommended).toBe("double");
        const insufficient = blackjackAdvice({ ...input, balance: 2 });
        expect(insufficient.double).toBeNull();
        expect(insufficient.recommended).toBe("hit");
        expect(blackjackAdvice({ ...input, player: [card("2"), card("4"), card("10")] }).double).toBeNull();
        expect(blackjackAdvice({ ...input, bet: Number.MAX_SAFE_INTEGER / 3, balance: Number.MAX_SAFE_INTEGER }).double).toBeNull();
    });

    test("matches an independent exhaustive dealer calculation with multiple aces", () => {
        const player = [card("10"), card("8")];
        const dealer = [card("A"), card("2")];
        const nextCard = card("A");
        const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
        const outcomes = { win: 0, push: 0, loss: 0 };
        const walk = (cards: BlackjackCard[], weight: number) => {
            const total = blackjackHandValue(cards);
            if (total >= 17) {
                outcomes[total > 21 || total < 18 ? "win" : total === 18 ? "push" : "loss"] += weight;
                return;
            }
            for (const rank of ranks) walk([...cards, card(rank)], weight / 13);
        };
        walk([...dealer, nextCard], 1);
        const advice = blackjackAdvice({ player, dealer, nextCard, bet: 10, balance: 10, payoutMultiplier: 1 });
        expect(advice.stand.win).toBeCloseTo(outcomes.win * 100, 8);
        expect(advice.stand.push).toBeCloseTo(outcomes.push * 100, 8);
        expect(advice.stand.loss).toBeCloseTo(outcomes.loss * 100, 8);
        expect(advice.stand.win + advice.stand.push + advice.stand.loss).toBeCloseTo(100, 8);
    });

    test("does not consume the next card when a standing dealer needs no draw", () => {
        const input = {
            player: [card("10"), card("7")], dealer: [card("10"), card("7")], nextCard: card("10"),
            bet: 10, balance: 0, payoutMultiplier: 1,
        };
        const advice = blackjackAdvice(input);
        expect(advice.stand).toMatchObject({ push: 100, expectedNet: 0 });
        expect(advice.hit).toMatchObject({ loss: 100 });
        expect(advice.double).toBeNull();
    });
});
