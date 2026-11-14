import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { POKER_RANKS, POKER_SUITS } from "../src/pokerHands.js";
import type { HouseGame } from "../src/houseLearnsGame.js";
import express from "express";
import type { Server } from "node:http";

const auth = vi.hoisted(() => ({ user: null as { id: string; username: string } | null }));
vi.mock("../src/auth.js", async importOriginal => {
    const actual = await importOriginal<typeof import("../src/auth.js")>();
    return { ...actual, loadSession: async () => auth.user };
});

const databaseUrl = process.env.HOUSE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("The House Learns transactions", () => {
    let db: typeof import("../src/database.js");
    let house: typeof import("../src/houseLearnsStorage.js");
    let Player: typeof import("../src/classes/Player.js").default;
    let server: Server;
    let url: string;
    beforeAll(async () => {
        process.env.POSTGRES_URL = databaseUrl;
        process.env.REDIS_URL = "redis://127.0.0.1:1";
        db = await import("../src/database.js");
        house = await import("../src/houseLearnsStorage.js");
        Player = (await import("../src/classes/Player.js")).default;
        await db.initDatabase();
        vi.spyOn(Player, "invalidate").mockResolvedValue();
        const app = express();
        app.use("/developer", (await import("../src/api/developer.js")).default);
        app.use(express.json(), (await import("../src/api/casino.js")).default);
        server = app.listen(0);
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test server address");
        url = `http://127.0.0.1:${address.port}`;
        for (const id of ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"]) {
            await db.pool.query("INSERT INTO players (id,data) VALUES ($1,$2::jsonb)", [id, JSON.stringify({ name: id, balance: 10000 })]);
        }
    });
    afterAll(async () => {
        vi.restoreAllMocks();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await db.pool.end();
    });

    async function prepareWinningRiver(id: string) {
        const result = await db.pool.query<{ state: HouseGame }>("SELECT state FROM house_learns_matches WHERE id=$1", [id]);
        const game = result.rows[0].state;
        game.stage = "river";
        game.turn = 0;
        game.board = [{ rank: "2", suit: "♠" }, { rank: "3", suit: "♥" }, { rank: "4", suit: "♣" }, { rank: "8", suit: "♦" }, { rank: "9", suit: "♠" }];
        game.seats[0] = { chips: 10, bet: game.wager - 10, total: game.wager - 10, acted: false, hole: [{ rank: "A", suit: "♠" }, { rank: "A", suit: "♥" }] };
        game.seats[1] = { chips: 0, bet: game.wager, total: game.wager, acted: true, hole: [{ rank: "K", suit: "♣" }, { rank: "K", suit: "♦" }] };
        const dealt = [...game.board, ...game.seats.flatMap(seat => seat.hole)];
        game.deck = POKER_RANKS.flatMap(rank => POKER_SUITS.map(suit => ({ rank, suit })))
            .filter(card => !dealt.some(used => used.rank === card.rank && used.suit === card.suit));
        await db.pool.query("UPDATE house_learns_matches SET state=$2::jsonb WHERE id=$1", [id, JSON.stringify(game)]);
    }

    test("escrows once, resumes persisted hands and applies expiry and recovery", async () => {
        const start = await house.startHouseGame("one", 100);
        const duplicate = await Promise.allSettled([house.startHouseGame("one", 100), house.startHouseGame("one", 100)]);
        expect(duplicate.every(result => result.status === "rejected")).toBe(true);
        expect((await Player.findById("one"))?.balance).toBe(9900);
        expect((await house.houseStatus("one")).match?.id).toBe(start.match.id);
        await db.pool.query("UPDATE house_learns_matches SET deadline=now()-interval '1 minute' WHERE id=$1", [start.match.id]);
        await house.recoverHouseLearns();
        expect((await house.houseStatus("one")).match?.status).toBe("active");
        await db.pool.query("UPDATE house_learns_matches SET deadline=now()-interval '1 minute' WHERE id=$1", [start.match.id]);
        await house.tickHouseLearns();
        const state = await house.houseStatus("one");
        expect(state.match?.status).toBe("house");
        expect(state.stats).toEqual({ pool: "100", games: "1", houseWins: "1" });
    });

    test("forfeits concurrent matches exactly once and pools their wagers", async () => {
        const [two, three] = await Promise.all([house.startHouseGame("two", 200), house.startHouseGame("three", 300)]);
        const results = await Promise.allSettled([
            house.moveHouseGame("two", two.match.id, "forfeit", undefined, two.match.revision),
            house.moveHouseGame("two", two.match.id, "forfeit", undefined, two.match.revision),
            house.moveHouseGame("three", three.match.id, "forfeit", undefined, three.match.revision),
        ]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
        expect((await house.houseStatus("two")).stats).toEqual({ pool: "600", games: "3", houseWins: "3" });
    });

    test("stores per-player and shared learning from actual actions", async () => {
        const game = await house.startHouseGame("four", 100);
        const results = await Promise.allSettled([
            house.moveHouseGame("four", game.match.id, "call", undefined, game.match.revision),
            house.moveHouseGame("four", game.match.id, "call", undefined, game.match.revision),
        ]);
        expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
        const result = await db.pool.query("SELECT id,data FROM house_learns_profiles ORDER BY id");
        expect(result.rows.map(row => row.id)).toEqual(["global", "player:four"]);
        expect(result.rows[0].data.actions).toBe(1);
        expect(result.rows[1].data.calls).toBe(1);
        const search = await (await fetch(`${url}/developer/house-learns/players?search=FOU`)).json();
        expect(search.players).toEqual([{ id: "four", name: "four", learned: true }]);
        expect((await (await fetch(`${url}/developer/house-learns/players?search=%25`)).json()).players).toEqual([]);
        const detail = await (await fetch(`${url}/developer/house-learns/players/four`)).json();
        expect(detail.player).toEqual({ actions: 1, raises: 0, calls: 1, folds: 0 });
        expect(detail.global).toEqual(detail.player);
        expect(detail.tactics.foldAdjustment).toBeCloseTo((2 / 7.1) * 0.12);
        const unobserved = await (await fetch(`${url}/developer/house-learns/players/five`)).json();
        expect(unobserved.player.actions).toBe(0);
        expect(unobserved.global.actions).toBe(1);
        const current = await house.houseStatus("four");
        await house.moveHouseGame("four", game.match.id, "forfeit", undefined, current.match!.revision);
    });

    test("settles simultaneous winners against the pool once", async () => {
        const [four, five] = await Promise.all([house.startHouseGame("four", 100), house.startHouseGame("five", 100)]);
        await Promise.all([prepareWinningRiver(four.match.id), prepareWinningRiver(five.match.id)]);
        const winners = await Promise.all([
            house.moveHouseGame("four", four.match.id, "call", undefined, four.match.revision),
            house.moveHouseGame("five", five.match.id, "call", undefined, five.match.revision),
        ]);
        expect(winners.map(result => BigInt(result.match!.payout)).sort((a, b) => Number(a - b))).toEqual([233n, 233n]);
        expect((await house.houseStatus("four")).stats).toEqual({ pool: "434", games: "6", houseWins: "4" });
    });

    test("preserves overflow as a claim until the balance has room", async () => {
        await db.pool.query("UPDATE house_learns_pool SET pool=0 WHERE id=1");
        const match = await house.startHouseGame("six", 100);
        await prepareWinningRiver(match.match.id);
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','9007199254740991'::jsonb) WHERE id='six'");
        const result = await house.moveHouseGame("six", match.match.id, "call", undefined, match.match.revision);
        expect(result.match?.unclaimed).toBe("100");
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','9007199254740891'::jsonb) WHERE id='six'");
        expect((await house.houseStatus("six")).pending).toBe("0");
        expect((await house.houseStatus("six")).pending).toBe("0");
        const balance = await db.pool.query("SELECT data->>'balance' AS balance FROM players WHERE id='six'");
        expect(balance.rows[0].balance).toBe("9007199254740991");
    });

    test("pays the minimum share for a large pool and leaves the rest", async () => {
        const match = await house.startHouseGame("nine", 100);
        await prepareWinningRiver(match.match.id);
        await db.pool.query("UPDATE house_learns_pool SET pool=100000000000 WHERE id=1");
        const result = await house.moveHouseGame("nine", match.match.id, "call", undefined, match.match.revision);
        expect(result.match?.payout).toBe("100000100");
        expect(result.stats.pool).toBe("99900000000");
        const balance = await db.pool.query("SELECT data->>'balance' AS balance FROM players WHERE id='nine'");
        expect(balance.rows[0].balance).toBe("100010000");
    });

    test("accepts wagers above the old limit up to the safe chip limit", async () => {
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','9007199254740991'::jsonb) WHERE id='ten'");
        const match = await house.startHouseGame("ten", 4_503_599_627_370_495);
        expect(match.match.game?.wager).toBe(4_503_599_627_370_495);
        await expect(house.startHouseGame("ten", 4_503_599_627_370_496)).rejects.toThrow("Wager must be");
        await house.moveHouseGame("ten", match.match.id, "forfeit", undefined, match.match.revision);
    });

    test("pays the whole pool at the 75% threshold even if the pool grows after entry", async () => {
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','100000000000'::jsonb) WHERE id='eleven'");
        await db.pool.query("UPDATE house_learns_pool SET pool=1 WHERE id=1");
        const match = await house.startHouseGame("eleven", 75_000_000_000);
        await prepareWinningRiver(match.match.id);
        await db.pool.query("UPDATE house_learns_pool SET pool=100000000000 WHERE id=1");
        const result = await house.moveHouseGame("eleven", match.match.id, "call", undefined, match.match.revision);
        expect(result.match?.payout).toBe("175000000000");
        expect(result.stats.pool).toBe("0");
        const balance = await db.pool.query("SELECT data->>'balance' AS balance FROM players WHERE id='eleven'");
        expect(balance.rows[0].balance).toBe("200000000000");
    });

    test("refunds unrecoverable games exactly once", async () => {
        const match = await house.startHouseGame("seven", 100);
        await db.pool.query("UPDATE house_learns_matches SET state='{}'::jsonb WHERE id=$1", [match.match.id]);
        await house.recoverHouseLearns();
        await house.recoverHouseLearns();
        const result = await house.houseStatus("seven");
        expect(result.match?.status).toBe("refunded");
        expect(result.match?.game).toBeNull();
        expect((await Player.findById("seven"))?.balance).toBe(10000);
    });

    test("authenticates API requests and never exposes hidden cards or the deck", async () => {
        vi.stubEnv("DEVELOPER_ID", "eight");
        auth.user = null;
        expect((await fetch(`${url}/house-learns`)).status).toBe(401);
        auth.user = { id: "eight", username: "eight" };
        const post = (path: string, body: object, csrf = true) => fetch(`${url}/house-learns${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(csrf ? { "X-Requested-With": "XMLHttpRequest" } : {}) },
            body: JSON.stringify(body),
        });
        expect((await post("/start", { wager: 100 }, false)).status).toBe(400);
        const started = await (await post("/start", { wager: 100 })).json();
        expect(started.match.game.bot.hole).toEqual([]);
        expect(started.match.game).not.toHaveProperty("deck");
        const resumed = await (await fetch(`${url}/house-learns`)).json();
        expect(resumed.match.id).toBe(started.match.id);
        expect(resumed.match.game.bot.hole).toEqual([]);
        expect((await post(`/${started.match.id}/action`, { action: "call", revision: -1 })).status).toBe(409);
        expect((await post(`/${started.match.id}/action`, { action: "forfeit", revision: started.match.revision })).status).toBe(200);
        auth.user = null;
        vi.unstubAllEnvs();
    });
});
