import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./database.js";
import Player from "./classes/Player.js";
import { housePoolPrize, MAX_HOUSE_WAGER } from "./houseLearnsPrize.js";
import {
    emptyProfile, HouseGameError, houseGameView, isRecoverableHouseGame, newHouseGame, nextHouseHand, playHouseAction,
    type HouseGame, type PlayerProfile,
} from "./houseLearnsGame.js";

const timeoutSeconds = 300;

export class HouseError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

export async function initializeHouseLearns(): Promise<void> {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS house_learns_pool (
            id integer PRIMARY KEY CHECK (id = 1), pool numeric NOT NULL DEFAULT 0,
            games bigint NOT NULL DEFAULT 0, wins bigint NOT NULL DEFAULT 0
        );
        INSERT INTO house_learns_pool (id) VALUES (1) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS house_learns_profiles (
            id text PRIMARY KEY, data jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS house_learns_matches (
            id text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id),
            wager bigint NOT NULL, state jsonb NOT NULL, status text NOT NULL,
            deadline timestamptz NOT NULL, payout numeric NOT NULL DEFAULT 0,
            reason text, created_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz
        );
        CREATE UNIQUE INDEX IF NOT EXISTS house_learns_one_active
            ON house_learns_matches (player_id) WHERE status = 'active';
        ALTER TABLE house_learns_matches ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
        ALTER TABLE house_learns_matches ADD COLUMN IF NOT EXISTS credited numeric NOT NULL DEFAULT 0;
    `);
}

interface MatchRow {
    id: string;
    player_id: string;
    wager: string;
    state: HouseGame;
    status: string;
    payout: string;
    reason: string | null;
    deadline: Date;
    expired: boolean;
    revision: number;
    credited: string;
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1097823948)");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
}

async function profiles(client: PoolClient, user: string) {
    const result = await client.query<{ id: string; data: PlayerProfile }>(
        "SELECT id, data FROM house_learns_profiles WHERE id = ANY($1::text[])", [["global", `player:${user}`]],
    );
    return {
        global: result.rows.find(row => row.id === "global")?.data ?? emptyProfile(),
        player: result.rows.find(row => row.id === `player:${user}`)?.data ?? emptyProfile(),
    };
}

async function saveProfiles(client: PoolClient, user: string, player: PlayerProfile, global: PlayerProfile) {
    await client.query(
        `INSERT INTO house_learns_profiles (id,data) VALUES ('global',$1::jsonb),($2,$3::jsonb)
         ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
        [JSON.stringify(global), `player:${user}`, JSON.stringify(player)],
    );
}

async function stats(client: PoolClient) {
    const result = await client.query<{ pool: string; games: string; wins: string }>(
        "SELECT pool::text, games::text, wins::text FROM house_learns_pool WHERE id=1",
    );
    return { pool: result.rows[0].pool, games: result.rows[0].games, houseWins: result.rows[0].wins };
}

async function claimPrizes(client: PoolClient, user: string): Promise<boolean> {
    const pending = await client.query<{ id: string; remaining: string }>(
        `SELECT id, (payout-credited)::text AS remaining FROM house_learns_matches
         WHERE player_id=$1 AND status IN ('player','refunded') AND payout>credited ORDER BY finished_at, id FOR UPDATE`,
        [user],
    );
    let changed = false;
    for (const prize of pending.rows) {
        const credit = await client.query<{ amount: string }>(
            `WITH amount AS (
                SELECT LEAST($2::numeric, GREATEST(0, 9007199254740991-COALESCE((data->>'balance')::numeric,0))) AS value
                FROM players WHERE id=$1 FOR UPDATE
             )
             UPDATE players SET data=jsonb_set(data,'{balance}',to_jsonb(COALESCE((data->>'balance')::numeric,0)+amount.value))
             FROM amount WHERE id=$1 AND amount.value>0 RETURNING amount.value::text AS amount`,
            [user, prize.remaining],
        );
        if (!credit.rowCount) break;
        await client.query("UPDATE house_learns_matches SET credited=credited+$2::numeric WHERE id=$1", [prize.id, credit.rows[0].amount]);
        changed = true;
    }
    return changed;
}

async function active(client: PoolClient, user: string): Promise<MatchRow | null> {
    const result = await client.query<MatchRow>(
        "SELECT *, deadline <= clock_timestamp() AS expired FROM house_learns_matches WHERE player_id=$1 AND status='active' FOR UPDATE", [user],
    );
    return result.rows[0] ?? null;
}

async function settle(client: PoolClient, match: MatchRow, winner: "player" | "house", reason: string) {
    let payout = "0";
    if (winner === "house") {
        await client.query("UPDATE house_learns_pool SET pool=pool+$1, games=games+1, wins=wins+1 WHERE id=1", [match.wager]);
    } else {
        const result = await client.query<{ pool: string }>("SELECT pool::text FROM house_learns_pool WHERE id=1 FOR UPDATE");
        const prize = housePoolPrize(BigInt(result.rows[0].pool), BigInt(match.wager));
        payout = (prize + BigInt(match.wager)).toString();
        await client.query("UPDATE house_learns_pool SET pool=pool-$1::numeric, games=games+1 WHERE id=1", [prize.toString()]);
    }
    await client.query(
        `UPDATE house_learns_matches SET status=$2, payout=$3, reason=$4, state=$5::jsonb, finished_at=clock_timestamp()
         WHERE id=$1 AND status='active'`,
        [match.id, winner, payout, reason, JSON.stringify(match.state)],
    );
    if (winner === "player") await claimPrizes(client, match.player_id);
    return payout;
}

async function expire(client: PoolClient, match: MatchRow): Promise<boolean> {
    if (!match.expired) return false;
    match.state.winner = "house";
    match.state.stage = "finished";
    await settle(client, match, "house", "Your turn timed out; the entry wager was forfeited.");
    return true;
}

function publicMatch(match: MatchRow) {
    return {
        id: match.id, status: match.status, revision: match.revision,
        game: match.status === "refunded" ? null : houseGameView(match.state),
        deadline: match.deadline, payout: match.payout,
        unclaimed: (BigInt(match.payout) - BigInt(match.credited)).toString(), reason: match.reason,
    };
}

export async function houseStatus(user: string) {
    const result = await transaction(async client => {
        const claimed = await claimPrizes(client, user);
        const match = await active(client, user);
        if (match) await expire(client, match);
        const latest = await client.query<MatchRow>(
            "SELECT *, deadline <= clock_timestamp() AS expired FROM house_learns_matches WHERE player_id=$1 ORDER BY created_at DESC LIMIT 1", [user],
        );
        const pending = await client.query<{ total: string }>(
            "SELECT COALESCE(sum(payout-credited),0)::text AS total FROM house_learns_matches WHERE player_id=$1 AND status IN ('player','refunded')", [user],
        );
        return { stats: await stats(client), match: latest.rows[0] ? publicMatch(latest.rows[0]) : null, pending: pending.rows[0].total, claimed };
    });
    if (result.claimed) await Player.invalidate(user);
    return result;
}

export async function startHouseGame(user: string, wager: unknown) {
    if (typeof wager !== "number" || !Number.isSafeInteger(wager) || wager < 100 || wager > MAX_HOUSE_WAGER) {
        throw new HouseError(`Wager must be a whole number between 100 and ${MAX_HOUSE_WAGER}.`);
    }
    const result = await transaction(async client => {
        const existing = await active(client, user);
        if (existing) {
            if (!await expire(client, existing)) throw new HouseError("Finish your current match first.", 409);
        }
        const balance = await client.query(
            `UPDATE players SET data=jsonb_set(data,'{balance}',to_jsonb(COALESCE((data->>'balance')::numeric,0)-$2::numeric))
             WHERE id=$1 AND COALESCE((data->>'balance')::numeric,0)>=$2 RETURNING id`, [user, wager],
        );
        if (!balance.rowCount) throw new HouseError("Insufficient balance or player not found.", 409);
        const { player, global } = await profiles(client, user);
        const game = newHouseGame(wager, player, global);
        const inserted = await client.query<MatchRow>(
            `INSERT INTO house_learns_matches (id,player_id,wager,state,status,deadline)
             VALUES ($1,$2,$3,$4::jsonb,'active',clock_timestamp()+interval '5 minutes')
             RETURNING *, false AS expired`,
            [randomUUID(), user, wager, JSON.stringify(game)],
        );
        return { match: publicMatch(inserted.rows[0]), stats: await stats(client) };
    });
    await Player.invalidate(user);
    return result;
}

export async function moveHouseGame(user: string, matchId: string, move: unknown, amount: unknown, revision: unknown) {
    const result = await transaction(async client => {
        const match = await active(client, user);
        if (!match || match.id !== matchId) throw new HouseError("This match is no longer active.", 409);
        if (await expire(client, match)) return { expired: true, stats: await stats(client) };
        if (!Number.isSafeInteger(revision) || revision !== match.revision) {
            throw new HouseError("This game has changed. Refresh before acting.", 409);
        }
        if (move === "forfeit") {
            match.state.winner = "house";
            match.state.stage = "finished";
            await settle(client, match, "house", "You forfeited the match.");
        } else {
            const { player, global } = await profiles(client, user);
            try {
                if (move === "next") nextHouseHand(match.state, player, global);
                else if (move === "fold" || move === "call" || move === "raise") {
                    if (move === "raise" && typeof amount !== "number") throw new HouseGameError("Invalid raise amount.");
                    playHouseAction(match.state, move, typeof amount === "number" ? amount : undefined, player, global);
                    await saveProfiles(client, user, player, global);
                } else throw new HouseGameError("Unknown action.");
            } catch (error) {
                if (error instanceof HouseGameError) throw new HouseError(error.message);
                throw error;
            }
            if (match.state.winner) await settle(client, match, match.state.winner, "Tournament completed.");
            else await client.query(
                `UPDATE house_learns_matches SET state=$2::jsonb, revision=revision+1, deadline=clock_timestamp()+interval '5 minutes' WHERE id=$1`,
                [match.id, JSON.stringify(match.state)],
            );
        }
        const latest = await client.query<MatchRow>("SELECT *, false AS expired FROM house_learns_matches WHERE id=$1", [match.id]);
        return { match: publicMatch(latest.rows[0]), stats: await stats(client) };
    });
    await Player.invalidate(user);
    return result;
}

export async function tickHouseLearns() {
    await transaction(async client => {
        const matches = await client.query<MatchRow>(
            "SELECT *, true AS expired FROM house_learns_matches WHERE status='active' AND deadline<=clock_timestamp() FOR UPDATE",
        );
        for (const match of matches.rows) await expire(client, match);
    });
}

export async function recoverHouseLearns() {
    const refunded = await transaction(async client => {
        const users: string[] = [];
        const matches = await client.query<MatchRow>(
            "SELECT *, false AS expired FROM house_learns_matches WHERE status='active' FOR UPDATE",
        );
        for (const match of matches.rows) {
            if (isRecoverableHouseGame(match.state, Number(match.wager))) {
                await client.query(
                    `UPDATE house_learns_matches SET deadline=clock_timestamp()+($2::text || ' seconds')::interval WHERE id=$1`,
                    [match.id, timeoutSeconds],
                );
            } else {
                await client.query(
                    `UPDATE house_learns_matches SET status='refunded', payout=wager, reason='Match could not be recovered; your wager was returned.',
                     finished_at=clock_timestamp() WHERE id=$1`, [match.id],
                );
                await claimPrizes(client, match.player_id);
                users.push(match.player_id);
            }
        }
        return users;
    });
    for (const user of refunded) await Player.invalidate(user);
}
