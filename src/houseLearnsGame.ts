import { randomInt } from "node:crypto";
import { bestHand, compareScores, currentHandName, POKER_RANKS, POKER_SUITS, type PokerCard } from "./pokerHands.js";

type Seat = 0 | 1;
type Stage = "preflop" | "flop" | "turn" | "river" | "between" | "finished";
type PlayerAction = "fold" | "call" | "raise";

interface SeatState {
    chips: number;
    bet: number;
    total: number;
    acted: boolean;
    hole: PokerCard[];
}

export interface HouseGame {
    version: 1;
    wager: number;
    hand: number;
    dealer: Seat;
    blind: number;
    deck: PokerCard[];
    board: PokerCard[];
    stage: Stage;
    turn: Seat;
    minRaise: number;
    seats: [SeatState, SeatState];
    message: string;
    revealBot: boolean;
    winner: "player" | "house" | null;
}

export interface PlayerProfile {
    actions: number;
    raises: number;
    calls: number;
    folds: number;
}

export const emptyProfile = (): PlayerProfile => ({ actions: 0, raises: 0, calls: 0, folds: 0 });

export class HouseGameError extends Error {}

export function isRecoverableHouseGame(game: HouseGame, wager: number): boolean {
    if (!game || game.version !== 1 || game.wager !== wager ||
        !["preflop", "flop", "turn", "river", "between"].includes(game.stage) ||
        !Number.isSafeInteger(game.hand) || game.hand < 1 || ![0, 1].includes(game.dealer) ||
        ![0, 1].includes(game.turn) || !Number.isSafeInteger(game.blind) || game.blind < 1 ||
        !Number.isSafeInteger(game.minRaise) || game.minRaise < 1 ||
        !Array.isArray(game.deck) || !Array.isArray(game.board) || !Array.isArray(game.seats) || game.seats.length !== 2 ||
        game.winner !== null || typeof game.message !== "string" || typeof game.revealBot !== "boolean") return false;
    for (const seat of game.seats) {
        if (!seat || !Number.isSafeInteger(seat.chips) || seat.chips < 0 ||
            !Number.isSafeInteger(seat.bet) || seat.bet < 0 ||
            !Number.isSafeInteger(seat.total) || seat.total < seat.bet ||
            typeof seat.acted !== "boolean" || !Array.isArray(seat.hole) || seat.hole.length !== 2) return false;
    }
    const cards = [...game.deck, ...game.board, ...game.seats.flatMap(seat => seat.hole)];
    if (cards.length !== 52 || cards.some(card => !card || !POKER_RANKS.includes(card.rank) || !POKER_SUITS.includes(card.suit)) ||
        new Set(cards.map(card => `${card.rank}:${card.suit}`)).size !== 52) return false;
    const lengths: Record<Exclude<Stage, "finished">, number[]> = {
        preflop: [0], flop: [3], turn: [4], river: [5], between: [0, 3, 4, 5],
    };
    if (!lengths[game.stage as Exclude<Stage, "finished">].includes(game.board.length)) return false;
    const chips = game.seats.reduce((total, seat) => total + seat.chips, 0);
    const outstanding = game.stage === "between" ? 0 : game.seats.reduce((total, seat) => total + seat.total, 0);
    return chips + outstanding === wager * 2;
}

function post(seat: SeatState, amount: number) {
    const paid = Math.min(seat.chips, amount);
    seat.chips -= paid;
    seat.bet += paid;
    seat.total += paid;
}

function deck(): PokerCard[] {
    const cards = POKER_RANKS.flatMap(rank => POKER_SUITS.map(suit => ({ rank, suit })));
    for (let i = cards.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

function finishHand(game: HouseGame, winner: Seat | null, showdown: boolean) {
    const [player, bot] = game.seats;
    const pot = player.total + bot.total;
    if (winner === null) {
        player.chips += Math.floor(pot / 2);
        bot.chips += Math.floor(pot / 2);
        if (pot % 2) game.seats[game.dealer === 0 ? 1 : 0].chips++;
        game.message = "The hand is tied; the pot is split.";
    } else {
        game.seats[winner].chips += pot;
        game.message = `${winner === 0 ? "You win" : "Prestigious wins"} the hand.`;
    }
    game.revealBot = showdown;
    game.winner = player.chips === 0 ? "house" : bot.chips === 0 ? "player" : null;
    game.stage = game.winner ? "finished" : "between";
}

function showdown(game: HouseGame) {
    const [player, bot] = game.seats;
    if (player.total !== bot.total) {
        const high = player.total > bot.total ? player : bot;
        const extra = Math.abs(player.total - bot.total);
        high.total -= extra;
        high.bet -= Math.min(high.bet, extra);
        high.chips += extra;
    }
    const comparison = compareScores(bestHand([...player.hole, ...game.board]), bestHand([...bot.hole, ...game.board]));
    finishHand(game, comparison === 0 ? null : comparison > 0 ? 0 : 1, true);
}

function advance(game: HouseGame, last: Seat) {
    const seats = game.seats;
    const toAct = (i: Seat) => seats[i].chips > 0 &&
        (!seats[i].acted || seats[i].bet < Math.max(seats[0].bet, seats[1].bet));
    const other: Seat = last === 0 ? 1 : 0;
    if (toAct(other)) { game.turn = other; return; }
    if (toAct(last)) { game.turn = last; return; }
    while (true) {
        if (game.stage === "river") { showdown(game); return; }
        if (game.stage === "preflop") {
            game.stage = "flop";
            game.board.push(game.deck.pop()!, game.deck.pop()!, game.deck.pop()!);
        } else {
            game.stage = game.stage === "flop" ? "turn" : "river";
            game.board.push(game.deck.pop()!);
        }
        for (const seat of seats) { seat.bet = 0; seat.acted = false; }
        game.minRaise = game.blind;
        if (seats[0].chips > 0 && seats[1].chips > 0) {
            game.turn = game.dealer === 0 ? 1 : 0;
            return;
        }
    }
}

function action(game: HouseGame, seat: Seat, move: PlayerAction, amount?: number) {
    const actor = game.seats[seat];
    const other = game.seats[seat === 0 ? 1 : 0];
    const current = Math.max(actor.bet, other.bet);
    if (move === "fold") {
        finishHand(game, seat === 0 ? 1 : 0, false);
        return;
    }
    if (move === "call") {
        post(actor, current - actor.bet);
    } else if (move === "raise") {
        const cap = Math.min(actor.bet + actor.chips, other.bet + other.chips);
        if (!Number.isSafeInteger(amount) || amount === undefined || amount > cap || amount <= current ||
            (amount < current + game.minRaise && amount < cap)) throw new HouseGameError("Invalid raise amount.");
        const raise = amount - current;
        if (raise >= game.minRaise) game.minRaise = raise;
        post(actor, amount - actor.bet);
        other.acted = false;
    } else throw new HouseGameError("Invalid poker action.");
    actor.acted = true;
    advance(game, seat);
}

function botStrength(game: HouseGame): number {
    const hole = game.seats[1].hole;
    const available = deck().filter(card => ![...hole, ...game.board].some(known => known.rank === card.rank && known.suit === card.suit));
    let score = 0;
    const trials = 80;
    for (let i = 0; i < trials; i++) {
        const pool = available.slice();
        const draw = () => {
            const index = randomInt(pool.length);
            return pool.splice(index, 1)[0];
        };
        const opponent = [draw(), draw()];
        const board = [...game.board];
        while (board.length < 5) board.push(draw());
        const comparison = compareScores(bestHand([...hole, ...board]), bestHand([...opponent, ...board]));
        score += comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0;
    }
    return score / trials;
}

export function houseLearningRates(player: PlayerProfile, global: PlayerProfile) {
    const observations = player.actions + global.actions * 0.1;
    return {
        aggression: (player.raises + global.raises * 0.1 + 2) / (observations + 6),
        foldRate: (player.folds + global.folds * 0.1 + 1) / (observations + 4),
    };
}

export function houseLearningTactics(player: PlayerProfile, global: PlayerProfile) {
    const { aggression, foldRate } = houseLearningRates(player, global);
    return {
        aggression, foldRate,
        foldAdjustment: aggression * 0.12,
        bluffChance: Math.min(0.25, 0.03 + foldRate * 0.25),
    };
}

function botMove(game: HouseGame, player: PlayerProfile, global: PlayerProfile) {
    const bot = game.seats[1];
    const opponent = game.seats[0];
    const current = Math.max(bot.bet, opponent.bet);
    const call = Math.min(current - bot.bet, bot.chips);
    const pot = bot.total + opponent.total;
    const strength = botStrength(game);
    const { foldAdjustment, bluffChance } = houseLearningTactics(player, global);
    const cap = Math.min(bot.bet + bot.chips, opponent.bet + opponent.chips);
    const canRaise = cap > current;
    const bluff = randomInt(1000) / 1000 < bluffChance;
    if (canRaise && (strength > 0.7 || (call === 0 && bluff))) {
        const target = Math.min(cap, current + Math.max(game.minRaise, Math.floor(pot * 0.5)));
        action(game, 1, "raise", target);
        game.message = `Prestigious raised to ${target}.`;
    } else if (call > 0 && strength + foldAdjustment < call / (pot + call)) {
        action(game, 1, "fold");
    } else {
        action(game, 1, "call");
        if (game.stage !== "between" && game.stage !== "finished") game.message = call ? "Prestigious called." : "Prestigious checked.";
    }
}

export function nextHouseHand(game: HouseGame, profile: PlayerProfile, global: PlayerProfile) {
    if (game.stage !== "between") throw new HouseGameError("The next hand is not available.");
    game.hand++;
    game.dealer = game.dealer === 0 ? 1 : 0;
    game.blind = Math.min(game.wager * 2, Math.ceil(20 * 1.1 ** Math.floor((game.hand - 1) / 5)));
    game.deck = deck();
    game.board = [];
    game.stage = "preflop";
    game.revealBot = false;
    game.message = `Hand ${game.hand}.`;
    game.minRaise = game.blind;
    for (const seat of game.seats) {
        seat.bet = 0;
        seat.total = 0;
        seat.acted = false;
        seat.hole = [game.deck.pop()!, game.deck.pop()!];
    }
    post(game.seats[game.dealer], Math.ceil(game.blind / 2));
    post(game.seats[game.dealer === 0 ? 1 : 0], game.blind);
    game.turn = game.dealer;
    const [player, bot] = game.seats;
    if ((!player.chips && bot.bet >= player.bet) || (!bot.chips && player.bet >= bot.bet)) {
        player.acted = true;
        bot.acted = true;
        advance(game, game.dealer);
    } else if (game.seats[game.dealer].chips === 0) advance(game, game.dealer);
    playBot(game, profile, global);
}

export function newHouseGame(wager: number, profile: PlayerProfile, global: PlayerProfile): HouseGame {
    const seat = (): SeatState => ({ chips: wager, bet: 0, total: 0, acted: false, hole: [] });
    const game: HouseGame = {
        version: 1, wager, hand: 0, dealer: 1, blind: 20, deck: [], board: [], stage: "between",
        turn: 0, minRaise: 20, seats: [seat(), seat()], message: "", revealBot: false, winner: null,
    };
    nextHouseHand(game, profile, global);
    return game;
}

export function playBot(game: HouseGame, profile: PlayerProfile, global: PlayerProfile) {
    while (game.stage !== "between" && game.stage !== "finished" && game.turn === 1) botMove(game, profile, global);
}

export function playHouseAction(game: HouseGame, move: PlayerAction, amount: number | undefined, profile: PlayerProfile, global: PlayerProfile) {
    if (game.stage === "between" || game.stage === "finished" || game.turn !== 0) throw new HouseGameError("It is not your turn.");
    action(game, 0, move, amount);
    profile.actions++;
    global.actions++;
    const property = move === "raise" ? "raises" : move === "fold" ? "folds" : "calls";
    profile[property]++;
    global[property]++;
    playBot(game, profile, global);
}

export function houseGameView(game: HouseGame) {
    const [player, bot] = game.seats;
    const current = Math.max(player.bet, bot.bet);
    return {
        wager: game.wager, hand: game.hand, blind: game.blind, stage: game.stage, board: game.board,
        player: { chips: player.chips, bet: player.bet, hole: player.hole, currentHand: currentHandName([...player.hole, ...game.board]) },
        bot: { chips: bot.chips, bet: bot.bet, hole: game.revealBot ? bot.hole : [] },
        pot: game.stage === "between" || game.stage === "finished" ? 0 : player.total + bot.total,
        toCall: Math.min(player.chips, current - player.bet),
        minRaiseTo: current + game.minRaise, maxRaiseTo: Math.min(player.bet + player.chips, bot.bet + bot.chips),
        message: game.message, winner: game.winner,
    };
}
