import { describe, expect, test } from "vitest";
import { emptyProfile, houseGameView, houseLearningRates, houseLearningTactics, isRecoverableHouseGame, newHouseGame, nextHouseHand, playHouseAction } from "../src/houseLearnsGame.js";
import { POKER_RANKS, POKER_SUITS } from "../src/pokerHands.js";

describe("The House Learns tournament", () => {
    test("plays to a winner while conserving virtual chips and learning player actions", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(100, player, global);
        for (let i = 0; i < 500 && !game.winner; i++) {
            if (game.stage === "between") nextHouseHand(game, player, global);
            else playHouseAction(game, "call", undefined, player, global);
            expect(game.seats[0].chips + game.seats[1].chips +
                (game.stage === "between" || game.stage === "finished" ? 0 : game.seats[0].total + game.seats[1].total)).toBe(200);
        }
        expect(game.winner).toMatch(/player|house/);
        expect(player.actions).toBeGreaterThan(0);
        expect(global).toEqual(player);
    });

    test("hides bot cards while playing and rejects invalid raises", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(100, player, global);
        expect(houseGameView(game).bot.hole).toEqual([]);
        expect(() => playHouseAction(game, "raise", 100000, player, global)).toThrow("Invalid raise");
        expect(player.actions).toBe(0);
    });

    test("increases blinds after five hands", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(1000, player, global);
        game.stage = "between";
        game.hand = 5;
        game.seats[0].chips = 1000;
        game.seats[1].chips = 1000;
        nextHouseHand(game, player, global);
        expect(game.blind).toBe(22);
    });

    test("adapts separately to player and shared observations", () => {
        const empty = emptyProfile();
        const aggressive = { actions: 100, raises: 100, calls: 0, folds: 0 };
        const folding = { actions: 100, raises: 0, calls: 0, folds: 100 };
        const baseline = houseLearningRates(empty, empty);
        expect(houseLearningRates(aggressive, empty).aggression).toBeGreaterThan(baseline.aggression);
        expect(houseLearningRates(empty, aggressive).aggression).toBeGreaterThan(baseline.aggression);
        expect(houseLearningRates(folding, empty).foldRate).toBeGreaterThan(baseline.foldRate);
        expect(houseLearningRates(empty, folding).foldRate).toBeGreaterThan(baseline.foldRate);
        expect(houseLearningTactics(aggressive, empty).foldAdjustment).toBeGreaterThan(houseLearningTactics(empty, empty).foldAdjustment);
        expect(houseLearningTactics(empty, folding).bluffChance).toBeGreaterThan(houseLearningTactics(empty, empty).bluffChance);
    });

    test("splits an all-in tie without losing chips", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(100, player, global);
        game.stage = "river";
        game.turn = 0;
        game.board = ["10", "J", "Q", "K", "A"].map(rank => ({ rank, suit: "♠" }));
        game.seats[0] = { chips: 10, bet: 90, total: 90, acted: false, hole: [{ rank: "2", suit: "♠" }, { rank: "3", suit: "♥" }] };
        game.seats[1] = { chips: 0, bet: 100, total: 100, acted: true, hole: [{ rank: "4", suit: "♣" }, { rank: "5", suit: "♦" }] };
        playHouseAction(game, "call", undefined, player, global);
        expect(game.stage).toBe("between");
        expect(game.seats.map(seat => seat.chips)).toEqual([100, 100]);
        expect(houseGameView(game).pot).toBe(0);
        expect(houseGameView(game).bot.hole).toHaveLength(2);
    });

    test("returns an unmatched all-in bet before awarding the pot", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(75, player, global);
        game.stage = "river";
        game.turn = 0;
        game.board = [{ rank: "2", suit: "♠" }, { rank: "3", suit: "♥" }, { rank: "4", suit: "♣" }, { rank: "8", suit: "♦" }, { rank: "9", suit: "♠" }];
        game.seats[0] = { chips: 10, bet: 40, total: 40, acted: false, hole: [{ rank: "A", suit: "♠" }, { rank: "A", suit: "♥" }] };
        game.seats[1] = { chips: 0, bet: 100, total: 100, acted: true, hole: [{ rank: "K", suit: "♣" }, { rank: "K", suit: "♦" }] };
        const dealt = [...game.board, ...game.seats.flatMap(seat => seat.hole)];
        game.deck = POKER_RANKS.flatMap(rank => POKER_SUITS.map(suit => ({ rank, suit })))
            .filter(card => !dealt.some(used => used.rank === card.rank && used.suit === card.suit));
        playHouseAction(game, "call", undefined, player, global);
        expect(game.seats.map(seat => seat.chips)).toEqual([100, 50]);
        expect(game.stage).toBe("between");
        expect(isRecoverableHouseGame(game, 75)).toBe(true);
    });

    test("runs out the board when a blind is already all-in and no call is needed", () => {
        const player = emptyProfile();
        const global = emptyProfile();
        const game = newHouseGame(100, player, global);
        game.stage = "between";
        game.seats[0].chips = 1;
        game.seats[1].chips = 199;
        game.dealer = 1;
        nextHouseHand(game, player, global);
        expect(["between", "finished"]).toContain(game.stage);
        expect(game.board).toHaveLength(5);
        expect(game.seats[0].chips + game.seats[1].chips).toBe(200);
    });
});
