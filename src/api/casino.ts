import { randomInt } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { loadSession } from "../auth.js";
import { getCache, getPool } from "../database.js";
import Player from "../classes/Player.js";
import lobbiesRouter from "./lobbies.js";

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
casinoRouter.use("/lobbies", lobbiesRouter);

// Stats must never break a game, so failures are only logged.
export async function recordBets(
    userId: string,
    game: "plinko" | "blackjack" | "bills" | "poker",
    rounds: { bet: number; payout: number }[],
): Promise<void> {
    try {
        await getPool().query(
            `INSERT INTO casino_bets (user_id, game, bet, payout)
             SELECT $1, $2, bet, payout
             FROM unnest($3::bigint[], $4::bigint[]) AS t(bet, payout)`,
            [userId, game, rounds.map((r) => r.bet), rounds.map((r) => r.payout)],
        );
    } catch (error) {
        console.error("Failed to record casino bets:", error);
    }
}

casinoRouter.get("/stats", async (request, response) => {
    const sort = request.query.sort === "wagered" ? "wagered" : "net";
    const pool = getPool();

    const [house, leaders, biggest] = await Promise.all([
        pool.query<{ wagered: string; paid: string; rounds: string }>(
            `SELECT COALESCE(SUM(bet), 0) AS wagered,
                    COALESCE(SUM(payout), 0) AS paid,
                    COUNT(*) AS rounds
             FROM casino_bets`,
        ),
        pool.query(
            `SELECT b.user_id AS id,
                    COALESCE(p.data->>'name', b.user_id) AS name,
                    SUM(b.bet) AS wagered,
                    SUM(b.payout) - SUM(b.bet) AS net,
                    COUNT(*) AS rounds
             FROM casino_bets b
             LEFT JOIN players p ON p.id = b.user_id
             GROUP BY b.user_id, p.data->>'name'
             ORDER BY ${sort === "wagered" ? "wagered" : "net"} DESC
             LIMIT 10`,
        ),
        pool.query(
            `SELECT * FROM (
                 SELECT DISTINCT ON (b.user_id)
                        COALESCE(p.data->>'name', b.user_id) AS name,
                        b.game, b.bet, b.payout, b.created_at
                 FROM casino_bets b
                 LEFT JOIN players p ON p.id = b.user_id
                 WHERE b.payout > b.bet
                 ORDER BY b.user_id, b.payout - b.bet DESC, b.payout::numeric / b.bet DESC
             ) best
             ORDER BY payout - bet DESC, payout::numeric / bet DESC
             LIMIT 10`,
        ),
    ]);

    const wagered = Number(house.rows[0].wagered);
    const paid = Number(house.rows[0].paid);
    response.json({
        sort,
        house: {
            wagered,
            paidOut: paid,
            net: wagered - paid,
            rounds: Number(house.rows[0].rounds),
        },
        leaders: leaders.rows.map((row) => ({
            name: row.name,
            wagered: Number(row.wagered),
            net: Number(row.net),
            rounds: Number(row.rounds),
        })),
        biggestWins: biggest.rows.map((row) => ({
            name: row.name,
            game: row.game,
            bet: Number(row.bet),
            payout: Number(row.payout),
            multiplier: Number(row.payout) / Number(row.bet),
            createdAt: row.created_at,
        })),
    });
});

// Applies a balance change only if the balance is at least `required`; returns the new balance or null.
export async function adjustBalance(
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
    const drops = Array.from({ length: balls }, () => {
        const path = Array.from({ length: rows }, () => randomInt(2));
        const slot = path.reduce<number>((sum, step) => sum + step, 0);
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
    await recordBets(
        userId,
        "plinko",
        drops.map((drop) => ({ bet, payout: drop.payout })),
    );

    response.json({
        drops,
        multipliers,
        totalBet,
        totalPayout,
        balance: Number(result.rows[0].balance),
    });
});

// Pass the Bills: a circle of players each put down BILLS_PER_PLAYER bills and pass them around with dice.

const BILLS_PER_PLAYER = 3;
const BILLS_MIN_PLAYERS = 3;
const BILLS_MAX_PLAYERS = 8;
// Indexed by players - BILLS_MIN_PLAYERS: 3 players (2 opponents) up to 8.
const BILLS_MULTIPLIERS = [1, 1.25, 1.5, 1.75, 2, 4];
const BILLS_MAX_TURNS = 2000;
const BILLS_FACES = ["circle", "star", "left", "right"] as const;

type BillsFace = (typeof BILLS_FACES)[number];

interface BillsTurn {
    seat: number;
    dice: BillsFace[];
    bills: number[];
    center: number;
}

function simulateBills(players: number) {
    const bills = Array<number>(players).fill(BILLS_PER_PLAYER);
    let center = 0;
    let inPlay = players * BILLS_PER_PLAYER;
    let seat = randomInt(players);
    const turns: BillsTurn[] = [];
    const roll = (): BillsFace => BILLS_FACES[randomInt(BILLS_FACES.length)];

    // Seat 0 is the player. Everyone with bills rolls up to 3 dice, one per bill.
    while (inPlay > 1 && turns.length < BILLS_MAX_TURNS) {
        const count = Math.min(BILLS_PER_PLAYER, bills[seat]);
        if (count > 0) {
            const dice: BillsFace[] = [];
            for (let i = 0; i < count && inPlay > 1; i++) {
                const face = roll();
                dice.push(face);
                if (face === "left" || face === "right") {
                    const target =
                        (seat + (face === "left" ? 1 : players - 1)) % players;
                    bills[seat]--;
                    bills[target]++;
                } else if (face === "star") {
                    bills[seat]--;
                    center++;
                    inPlay--;
                }
            }
            turns.push({ seat, dice, bills: [...bills], center });
        }
        seat = (seat + 1) % players;
    }

    // The holder of the last bill must roll a circle. Left/right passes it on, a star is a re-roll.
    let holder = bills.findIndex((count) => count > 0);
    const finale: { seat: number; face: BillsFace }[] = [];
    let winner = -1;
    while (winner < 0) {
        const face = finale.length >= BILLS_MAX_TURNS ? "circle" : roll();
        finale.push({ seat: holder, face });
        if (face === "circle") {
            winner = holder;
        } else if (face === "left") {
            holder = (holder + 1) % players;
        } else if (face === "right") {
            holder = (holder + players - 1) % players;
        }
    }

    return { turns, finale, winner, startBills: BILLS_PER_PLAYER };
}

casinoRouter.post("/bills", async (request, response) => {
    const { bet, players }: Record<string, unknown> = request.body ?? {};
    if (typeof bet !== "number" || !Number.isSafeInteger(bet) || bet < 1) {
        response.status(400).json({ error: "Bet must be a whole number of at least 1" });
        return;
    }
    if (
        typeof players !== "number" ||
        !Number.isInteger(players) ||
        players < BILLS_MIN_PLAYERS ||
        players > BILLS_MAX_PLAYERS
    ) {
        response.status(400).json({
            error: `Players must be between ${BILLS_MIN_PLAYERS} and ${BILLS_MAX_PLAYERS}`,
        });
        return;
    }

    const stake = bet * BILLS_PER_PLAYER;
    const pot = stake * players;
    const multiplier = BILLS_MULTIPLIERS[players - BILLS_MIN_PLAYERS];
    const winnings = Math.floor(pot * multiplier);
    if (!Number.isSafeInteger(winnings)) {
        response.status(400).json({ error: "Bet is too large" });
        return;
    }

    const userId: string = response.locals.userId;
    const game = simulateBills(players);
    const payout = game.winner === 0 ? winnings : 0;

    const nameRows = await getPool().query<{ name: string }>(
        `SELECT data->>'name' AS name
         FROM players
         WHERE id <> $1 AND COALESCE(data->>'name', '') <> ''
         ORDER BY random()
         LIMIT $2`,
        [userId, players - 1],
    );
    const names = ["You", ...nameRows.rows.map((row) => row.name)];
    while (names.length < players) {
        names.push(`Player ${names.length + 1}`);
    }

    const result = await getPool().query<{ balance: string }>(
        `UPDATE players
         SET data = jsonb_set(
             data,
             '{balance}',
             to_jsonb((data->>'balance')::numeric + $2::numeric)
         )
         WHERE id = $1 AND (data->>'balance')::numeric >= $3::numeric
         RETURNING data->>'balance' AS balance`,
        [userId, payout - stake, stake],
    );

    if (result.rowCount === 0) {
        const exists = await Player.exists(userId);
        response
            .status(exists ? 400 : 404)
            .json({ error: exists ? "Insufficient balance" : "Player not found" });
        return;
    }

    await Player.invalidate(userId);
    await recordBets(userId, "bills", [{ bet: stake, payout }]);

    response.json({
        ...game,
        names,
        players,
        stake,
        pot,
        multiplier,
        payout,
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
                state.dealer.push(drawCard());
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
    await recordBets(userId, "blackjack", [{ bet: state.bet, payout }]);
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

    const state: BlackjackState = {
        bet,
        player: [drawCard(), drawCard()],
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
        state.player.push(drawCard());
        response.json(await settleBlackjack(userId, state, handValue(state.player) > 21));
        return;
    }

    if (action === "hit") {
        state.player.push(drawCard());
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
