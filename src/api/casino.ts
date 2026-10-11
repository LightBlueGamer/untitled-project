import { randomInt } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { loadSession } from "../auth.js";
import { getCache, getPool } from "../database.js";
import Player from "../classes/Player.js";

const PLINKO_MIN_ROWS = 8;
const PLINKO_MAX_ROWS = 16;
const PLINKO_MAX_BALLS = 50;
const PLINKO_TARGET_RETURN = 1.0;

// max is the payout of the outermost slots; exponent controls how steeply payouts grow towards the edges.
const PLINKO_RISKS = {
    low: { max: 5, exponent: 6 },
    medium: { max: 10, exponent: 5 },
    high: { max: 20, exponent: 4 },
} as const;

type PlinkoRisk = keyof typeof PLINKO_RISKS;

function isRisk(value: unknown): value is PlinkoRisk {
    return typeof value === "string" && value in PLINKO_RISKS;
}

function isRows(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= PLINKO_MIN_ROWS &&
        value <= PLINKO_MAX_ROWS
    );
}

function binomial(rows: number, slot: number): number {
    let result = 1;
    for (let i = 1; i <= slot; i++) {
        result = (result * (rows - slot + i)) / i;
    }
    return result;
}

// Scales the payouts so the expected return is the target, then rounds down so the house edge never shrinks.
function plinkoMultipliers(rows: number, risk: PlinkoRisk): number[] {
    const { exponent } = PLINKO_RISKS[risk];
    // The top payout grows linearly from 25% of the risk's max at the fewest rows to 100% at the most rows.
    const rowFactor =
        0.25 +
        (0.75 * (rows - PLINKO_MIN_ROWS)) / (PLINKO_MAX_ROWS - PLINKO_MIN_ROWS);
    const max = PLINKO_RISKS[risk].max * rowFactor;
    const centre = rows / 2;
    const shape = Array.from({ length: rows + 1 }, (_, slot) =>
        Math.pow(Math.abs(slot - centre) / centre, exponent),
    );
    const total = 2 ** rows;
    const expectedShape = shape.reduce(
        (sum, value, slot) => sum + (value * binomial(rows, slot)) / total,
        0,
    );
    // Solve floor + scale = max and floor + scale * expectedShape = target return.
    const scale = (max - PLINKO_TARGET_RETURN) / (1 - expectedShape);
    const floor = max - scale;

    return shape.map(
        (value) => Math.floor((floor + scale * value) * 100) / 100,
    );
}

const casinoRouter = Router();

const requireSession: RequestHandler = async (request, response, next) => {
    try {
        const user = await loadSession(request.headers.cookie);
        if (!user) {
            response.status(401).json({ error: "Login required" });
            return;
        }
        response.locals.userId = user.id;
        response.setHeader("Cache-Control", "no-store");
        next();
    } catch (error) {
        next(error);
    }
};

casinoRouter.use(requireSession);

// Applies a balance change only if the balance is at least `required`; returns the new balance or null.
async function adjustBalance(
    userId: string,
    delta: number,
    required: number,
): Promise<number | null> {
    const result = await getPool().query<{ balance: string }>(
        `UPDATE players
         SET data = jsonb_set(
             data,
             '{balance}',
             to_jsonb((data->>'balance')::numeric + $2::numeric)
         )
         WHERE id = $1 AND (data->>'balance')::numeric >= $3::numeric
         RETURNING data->>'balance' AS balance`,
        [userId, delta, required],
    );
    if (result.rowCount === 0) {
        return null;
    }
    await Player.invalidate(userId);
    return Number(result.rows[0].balance);
}

async function currentBalance(userId: string): Promise<number> {
    const result = await getPool().query<{ balance: string }>(
        `SELECT data->>'balance' AS balance FROM players WHERE id = $1`,
        [userId],
    );
    return Number(result.rows[0]?.balance ?? 0);
}

casinoRouter.get("/balance", async (_request, response) => {
    const result = await getPool().query<{ balance: string }>(
        `SELECT data->>'balance' AS balance FROM players WHERE id = $1`,
        [response.locals.userId],
    );

    if (result.rowCount === 0) {
        response.status(404).json({ error: "Player not found" });
        return;
    }

    response.json({ balance: Number(result.rows[0].balance) });
});

casinoRouter.get("/plinko", (request, response) => {
    const rows = Number(request.query.rows);
    const risk = request.query.risk;
    if (!isRows(rows) || !isRisk(risk)) {
        response.status(400).json({ error: "Invalid rows or risk" });
        return;
    }

    response.json({ rows, risk, multipliers: plinkoMultipliers(rows, risk) });
});

casinoRouter.post("/plinko", async (request, response) => {
    const { bet, balls, rows, risk }: Record<string, unknown> =
        request.body ?? {};
    if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < 1) {
        response.status(400).json({ error: "Bet must be a whole number of at least 1" });
        return;
    }
    if (
        typeof balls !== "number" ||
        !Number.isInteger(balls) ||
        balls < 1 ||
        balls > PLINKO_MAX_BALLS
    ) {
        response
            .status(400)
            .json({ error: `Balls must be between 1 and ${PLINKO_MAX_BALLS}` });
        return;
    }
    if (!isRows(rows) || !isRisk(risk)) {
        response.status(400).json({ error: "Invalid rows or risk" });
        return;
    }

    const totalBet = bet * balls;
    if (!Number.isSafeInteger(totalBet)) {
        response.status(400).json({ error: "Total bet is too large" });
        return;
    }

    const multipliers = plinkoMultipliers(rows, risk);
    const userId: string = response.locals.userId;
    const owner = isOwner(userId);
    const rollPath = () => Array.from({ length: rows }, () => randomInt(2));
    const drops = Array.from({ length: balls }, () => {
        let path = rollPath();
        const slotOf = (p: number[]) => p.reduce<number>((sum, step) => sum + step, 0);
        if (owner && randomInt(100) < 35) {
            const other = rollPath();
            if (multipliers[slotOf(other)] > multipliers[slotOf(path)]) {
                path = other;
            }
        }
        const slot = slotOf(path);
        const multiplier = multipliers[slot];
        return { path, slot, multiplier, payout: Math.floor(bet * multiplier) };
    });
    const totalPayout = drops.reduce((sum, drop) => sum + drop.payout, 0);
    const delta = totalPayout - totalBet;

    // One conditional update keeps the balance check and change atomic.
    const result = await getPool().query<{ balance: string }>(
        `UPDATE players
         SET data = jsonb_set(
             data,
             '{balance}',
             to_jsonb((data->>'balance')::numeric + $2::numeric)
         )
         WHERE id = $1 AND (data->>'balance')::numeric >= $3::numeric
         RETURNING data->>'balance' AS balance`,
        [userId, delta, totalBet],
    );

    if (result.rowCount === 0) {
        const exists = await Player.exists(userId);
        response
            .status(exists ? 400 : 404)
            .json({ error: exists ? "Insufficient balance" : "Player not found" });
        return;
    }

    await Player.invalidate(userId);

    response.json({
        drops,
        multipliers,
        totalBet,
        totalPayout,
        balance: Number(result.rows[0].balance),
    });
});

// Blackjack

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const BLACKJACK_STATE_TTL_SECONDS = 60 * 60;

type Card = { rank: string; suit: string };
type Outcome = "blackjack" | "win" | "push" | "lose" | "bust";

interface BlackjackState {
    bet: number;
    player: Card[];
    dealer: Card[];
}

const blackjackKey = (userId: string) => `blackjack:${userId}`;

function drawCard(): Card {
    return { rank: RANKS[randomInt(RANKS.length)], suit: SUITS[randomInt(SUITS.length)] };
}

const isOwner = (userId: string) => !!process.env.OWNER_ID && userId === process.env.OWNER_ID;

// Occasionally draws a second candidate and keeps the better one.
function drawForPlayer(userId: string, hand: Card[]): Card {
    const first = drawCard();
    if (!isOwner(userId) || randomInt(100) >= 30) {
        return first;
    }
    const second = drawCard();
    const score = (card: Card) => {
        const total = handValue([...hand, card]);
        return total > 21 ? -total : total;
    };
    return score(second) > score(first) ? second : first;
}

function drawForDealer(userId: string, hand: Card[]): Card {
    const first = drawCard();
    if (!isOwner(userId) || randomInt(100) >= 25) {
        return first;
    }
    const second = drawCard();
    if (handValue([...hand, first]) > 21) {
        return first;
    }
    return handValue([...hand, second]) > 21 ? second : first;
}

function handValue(cards: Card[]): number {
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

const isBlackjack = (cards: Card[]) => cards.length === 2 && handValue(cards) === 21;

async function loadBlackjack(userId: string): Promise<BlackjackState | null> {
    const raw = await getCache().get(blackjackKey(userId));
    return raw ? (JSON.parse(raw) as BlackjackState) : null;
}

async function saveBlackjack(userId: string, state: BlackjackState): Promise<void> {
    await getCache().set(blackjackKey(userId), JSON.stringify(state), {
        EX: BLACKJACK_STATE_TTL_SECONDS,
    });
}

function blackjackView(state: BlackjackState, balance: number, outcome?: Outcome, payout = 0) {
    const finished = outcome !== undefined;
    return {
        active: !finished,
        bet: state.bet,
        player: state.player,
        playerTotal: handValue(state.player),
        dealer: finished ? state.dealer : [state.dealer[0]],
        dealerTotal: finished ? handValue(state.dealer) : handValue([state.dealer[0]]),
        dealerHidden: !finished,
        canDouble: !finished && state.player.length === 2,
        outcome,
        payout,
        balance,
    };
}

// Dealer stands on all 17s. Pays 3:2 for blackjack, 1:1 for wins, and returns the bet on a push.
async function settleBlackjack(userId: string, state: BlackjackState, busted: boolean) {
    let outcome: Outcome;
    let payout: number;

    if (busted) {
        outcome = "bust";
        payout = 0;
    } else {
        const playerBlackjack = isBlackjack(state.player);
        const dealerBlackjack = isBlackjack(state.dealer);

        if (!playerBlackjack) {
            while (handValue(state.dealer) < 17) {
                state.dealer.push(drawForDealer(userId, state.dealer));
            }
        }

        const player = handValue(state.player);
        const dealer = handValue(state.dealer);

        if (playerBlackjack && dealerBlackjack) {
            outcome = "push";
            payout = state.bet;
        } else if (playerBlackjack) {
            outcome = "blackjack";
            payout = Math.floor(state.bet * 2.5);
        } else if (dealerBlackjack || (dealer <= 21 && dealer > player)) {
            outcome = "lose";
            payout = 0;
        } else if (dealer > 21 || player > dealer) {
            outcome = "win";
            payout = state.bet * 2;
        } else {
            outcome = "push";
            payout = state.bet;
        }
    }

    await getCache().del(blackjackKey(userId));
    const balance =
        payout > 0
            ? ((await adjustBalance(userId, payout, 0)) ?? (await currentBalance(userId)))
            : await currentBalance(userId);
    return blackjackView(state, balance, outcome, payout);
}

// Serialises requests per player so two tabs cannot act on the same hand at once.
const blackjackBusy = new Set<string>();

casinoRouter.use("/blackjack", (_request, response, next) => {
    const userId: string = response.locals.userId;
    if (blackjackBusy.has(userId)) {
        response.status(429).json({ error: "Please wait a moment" });
        return;
    }
    blackjackBusy.add(userId);
    response.on("close", () => blackjackBusy.delete(userId));
    next();
});

casinoRouter.get("/blackjack", async (_request, response) => {
    const userId: string = response.locals.userId;
    const state = await loadBlackjack(userId);
    if (!state) {
        response.json({ active: false, balance: await currentBalance(userId) });
        return;
    }
    response.json(blackjackView(state, await currentBalance(userId)));
});

casinoRouter.post("/blackjack/start", async (request, response) => {
    const userId: string = response.locals.userId;
    const bet: unknown = request.body?.bet;
    if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < 1) {
        response.status(400).json({ error: "Bet must be a whole number of at least 1" });
        return;
    }
    if (await loadBlackjack(userId)) {
        response.status(409).json({ error: "Finish your current hand first" });
        return;
    }

    const balance = await adjustBalance(userId, -bet, bet);
    if (balance === null) {
        const exists = await Player.exists(userId);
        response
            .status(exists ? 400 : 404)
            .json({ error: exists ? "Insufficient balance" : "Player not found" });
        return;
    }

    const first = drawForPlayer(userId, []);
    const state: BlackjackState = {
        bet,
        player: [first, drawForPlayer(userId, [first])],
        dealer: [drawCard(), drawCard()],
    };

    try {
        if (handValue(state.player) === 21 || isBlackjack(state.dealer)) {
            response.json(await settleBlackjack(userId, state, false));
            return;
        }
        await saveBlackjack(userId, state);
    } catch (error) {
        await adjustBalance(userId, bet, 0);
        throw error;
    }
    response.json(blackjackView(state, balance));
});

casinoRouter.post("/blackjack/action", async (request, response) => {
    const userId: string = response.locals.userId;
    const action: unknown = request.body?.action;
    if (action !== "hit" && action !== "stand" && action !== "double") {
        response.status(400).json({ error: "Invalid action" });
        return;
    }

    const state = await loadBlackjack(userId);
    if (!state) {
        response.status(404).json({ error: "No active hand" });
        return;
    }

    if (action === "double") {
        if (state.player.length !== 2) {
            response.status(400).json({ error: "You can only double on your first move" });
            return;
        }
        const balance = await adjustBalance(userId, -state.bet, state.bet);
        if (balance === null) {
            response.status(400).json({ error: "Insufficient balance to double" });
            return;
        }
        state.bet *= 2;
        state.player.push(drawForPlayer(userId, state.player));
        response.json(await settleBlackjack(userId, state, handValue(state.player) > 21));
        return;
    }

    if (action === "hit") {
        state.player.push(drawForPlayer(userId, state.player));
        const total = handValue(state.player);
        if (total > 21) {
            response.json(await settleBlackjack(userId, state, true));
            return;
        }
        if (total === 21) {
            response.json(await settleBlackjack(userId, state, false));
            return;
        }
        await saveBlackjack(userId, state);
        response.json(blackjackView(state, await currentBalance(userId)));
        return;
    }

    response.json(await settleBlackjack(userId, state, false));
});

export default casinoRouter;
