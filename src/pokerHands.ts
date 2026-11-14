import { randomInt } from "node:crypto";

export type PokerCard = { rank: string; suit: string };
export const POKER_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const POKER_SUITS = ["♠", "♥", "♦", "♣"];
export const HAND_NAMES = [
    "High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush",
    "Full house", "Four of a kind", "Straight flush",
];

export const rankValue = (rank: string) =>
    rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank);

function eval5(cards: PokerCard[]): number[] {
    const values = cards.map(card => rankValue(card.rank)).sort((a, b) => b - a);
    const flush = cards.every(card => card.suit === cards[0].suit);
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const ranksByGroup = groups.map(group => group[0]);
    const unique = [...new Set(values)];
    let straight = 0;
    if (unique.length === 5) {
        if (unique[0] - unique[4] === 4) straight = unique[0];
        else if (unique[0] === 14 && unique[1] === 5) straight = 5;
    }
    if (straight && flush) return [8, straight];
    if (groups[0][1] === 4) return [7, ...ranksByGroup];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...ranksByGroup];
    if (flush) return [5, ...values];
    if (straight) return [4, straight];
    if (groups[0][1] === 3) return [3, ...ranksByGroup];
    if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...ranksByGroup];
    if (groups[0][1] === 2) return [1, ...ranksByGroup];
    return [0, ...values];
}

export function compareScores(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

export function bestHand(cards: PokerCard[]): number[] {
    let best: number[] = [-1];
    const pick: PokerCard[] = [];
    const walk = (start: number) => {
        if (pick.length === 5) {
            const score = eval5(pick);
            if (compareScores(score, best) > 0) best = score;
            return;
        }
        for (let i = start; i < cards.length; i++) {
            pick.push(cards[i]);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    return best;
}

export function currentHandName(cards: PokerCard[]): string | null {
    if (!cards.length) return null;
    if (cards.length >= 5) return HAND_NAMES[bestHand(cards)[0]];
    const counts = new Map<string, number>();
    for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    const groups = [...counts.values()].sort((a, b) => b - a);
    if (groups[0] === 4) return HAND_NAMES[7];
    if (groups[0] === 3) return HAND_NAMES[3];
    if (groups[0] === 2 && groups[1] === 2) return HAND_NAMES[2];
    if (groups[0] === 2) return HAND_NAMES[1];
    return HAND_NAMES[0];
}

interface PokerPlayer {
    id: string;
    hole: PokerCard[];
    folded: boolean;
}

export function showdownWinners(players: PokerPlayer[], board: PokerCard[]): string[] {
    let best: number[] = [-1];
    let winners: string[] = [];
    for (const player of players) {
        if (player.folded || player.hole.length !== 2) continue;
        const score = bestHand([...player.hole, ...board]);
        const difference = compareScores(score, best);
        if (difference > 0) {
            best = score;
            winners = [player.id];
        } else if (difference === 0) winners.push(player.id);
    }
    return winners;
}

export function estimatePokerEquity(
    players: PokerPlayer[], community: PokerCard[], samples = 300,
    roll: (max: number) => number = randomInt,
): Record<string, number> {
    const active = players.filter(player => !player.folded && player.hole.length === 2);
    const totals = new Map(active.map(player => [player.id, 0]));
    const used = new Set([...community, ...players.flatMap(player => player.hole)].map(card => `${card.rank}:${card.suit}`));
    const remaining = POKER_RANKS.flatMap(rank =>
        POKER_SUITS.map(suit => ({ rank, suit })).filter(card => !used.has(`${card.rank}:${card.suit}`)));
    const missing = 5 - community.length;
    const iterations = missing === 0 ? 1 : samples;
    for (let trial = 0; trial < iterations; trial++) {
        const pool = remaining.slice();
        const board = [...community];
        for (let i = 0; i < missing; i++) {
            const index = roll(pool.length - i);
            board.push(pool[index]);
            pool[index] = pool[pool.length - i - 1];
        }
        const winners = showdownWinners(active, board);
        for (const id of winners) totals.set(id, totals.get(id)! + 1 / winners.length);
    }
    return Object.fromEntries([...totals].map(([id, value]) => [id, Math.round(value / iterations * 1000) / 10]));
}
