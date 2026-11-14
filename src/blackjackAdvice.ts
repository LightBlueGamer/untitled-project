export type BlackjackCard = { rank: string; suit: string };
type Result = "win" | "push" | "loss";
type Distribution = Record<Result, number>;

const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function blackjackHandValue(cards: BlackjackCard[]): number {
    let total = 0;
    let aces = 0;
    for (const { rank } of cards) {
        if (rank === "A") {
            aces++;
            total += 11;
        } else if (["J", "Q", "K"].includes(rank)) {
            total += 10;
        } else {
            total += Number(rank);
        }
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    return total;
}

function handState(cards: BlackjackCard[]): { total: number; soft: boolean } {
    const total = blackjackHandValue(cards);
    const lowTotal = cards.reduce((sum, card) => sum + (card.rank === "A" ? 1 :
        ["J", "Q", "K"].includes(card.rank) ? 10 : Number(card.rank)), 0);
    return { total, soft: total !== lowTotal };
}

function addRank(total: number, soft: boolean, rank: string) {
    let value = total + (rank === "A" ? 11 : ["J", "Q", "K"].includes(rank) ? 10 : Number(rank));
    let softAces = Number(soft) + Number(rank === "A");
    if (value > 21 && softAces) {
        value -= 10;
        softAces--;
    }
    return { total: value, soft: softAces > 0 };
}

function dealerOutcomes(cards: BlackjackCard[], firstCard?: BlackjackCard): Map<number, number> {
    let { total, soft } = handState(cards);
    if (total < 17 && firstCard) ({ total, soft } = addRank(total, soft, firstCard.rank));
    const memo = new Map<string, Map<number, number>>();
    const visit = (value: number, isSoft: boolean): Map<number, number> => {
        if (value >= 17) return new Map([[value > 21 ? 22 : value, 1]]);
        const key = `${value}:${isSoft}`;
        const cached = memo.get(key);
        if (cached) return cached;
        const result = new Map<number, number>();
        for (const rank of ranks) {
            const next = addRank(value, isSoft, rank);
            for (const [outcome, probability] of visit(next.total, next.soft)) {
                result.set(outcome, (result.get(outcome) ?? 0) + probability / ranks.length);
            }
        }
        memo.set(key, result);
        return result;
    };
    return visit(total, soft);
}

function probabilities(player: BlackjackCard[], dealer: BlackjackCard[], firstDealerCard?: BlackjackCard): Distribution {
    const total = blackjackHandValue(player);
    if (total > 21) return { win: 0, push: 0, loss: 1 };
    const playerBlackjack = player.length === 2 && total === 21;
    const dealerBlackjack = dealer.length === 2 && blackjackHandValue(dealer) === 21;
    if (playerBlackjack || dealerBlackjack) {
        return playerBlackjack && dealerBlackjack ? { win: 0, push: 1, loss: 0 } :
            playerBlackjack ? { win: 1, push: 0, loss: 0 } : { win: 0, push: 0, loss: 1 };
    }
    const result: Distribution = { win: 0, push: 0, loss: 0 };
    for (const [dealerTotal, probability] of dealerOutcomes(dealer, firstDealerCard)) {
        const outcome: Result = dealerTotal > 21 || total > dealerTotal ? "win" : total === dealerTotal ? "push" : "loss";
        result[outcome] += probability;
    }
    return result;
}

interface AdviceInput {
    player: BlackjackCard[];
    dealer: BlackjackCard[];
    nextCard: BlackjackCard;
    bet: number;
    balance: number;
    payoutMultiplier: number;
}

export function blackjackAdvice(input: AdviceInput) {
    const afterHit = [...input.player, input.nextCard];
    const describe = (distribution: Distribution, bet: number, blackjack = false) => {
        const payout = blackjack ? Math.floor(bet * 2.5) : bet * 2;
        const profit = Math.floor((payout - bet) * input.payoutMultiplier);
        return {
            win: distribution.win * 100,
            push: distribution.push * 100,
            loss: distribution.loss * 100,
            expectedNet: distribution.win * profit - distribution.loss * bet,
        };
    };
    const natural = input.player.length === 2 && blackjackHandValue(input.player) === 21;
    const stand = describe(probabilities(input.player, input.dealer, input.nextCard), input.bet, natural);
    const hit = describe(probabilities(afterHit, input.dealer), input.bet);
    const canDouble = input.player.length === 2 && input.balance >= input.bet &&
        Number.isSafeInteger(Math.floor(input.bet * 2 * 2.5 * input.payoutMultiplier));
    const double = canDouble ? describe(probabilities(afterHit, input.dealer), input.bet * 2) : null;
    const candidates = [
        { action: "stand", expectedNet: stand.expectedNet },
        { action: "hit", expectedNet: hit.expectedNet },
        ...(double ? [{ action: "double", expectedNet: double.expectedNet }] : []),
    ];
    const recommended = candidates.reduce((best, candidate) =>
        candidate.expectedNet > best.expectedNet ? candidate : best).action;
    return { stand, hit, double, recommended };
}
