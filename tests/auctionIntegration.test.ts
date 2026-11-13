import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.AUCTION_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("auction transactions on PostgreSQL", () => {
    let db: typeof import("../src/database.js");
    let auctions: typeof import("../src/auctionStorage.js");
    let Player: typeof import("../src/classes/Player.js").default;
    const prefix = randomUUID();
    const ids = ["seller", "buyer", "other", "promoter"].map(role => `auction-test-${prefix}-${role}`);
    beforeAll(async () => {
        process.env.POSTGRES_URL = databaseUrl;
        process.env.REDIS_URL = "redis://127.0.0.1:1";
        db = await import("../src/database.js");
        auctions = await import("../src/auctionStorage.js");
        Player = (await import("../src/classes/Player.js")).default;
        await db.initDatabase();
        for (const id of ids) await db.pool.query("INSERT INTO players (id,data) VALUES ($1,$2::jsonb)", [id, JSON.stringify({ name: id, balance: 10000 })]);
        await db.pool.query("INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,'wild_berries',20)", [ids[0]]);
    });
    afterAll(async () => { await db.pool.end(); });

    test("reserves assets and funds, handles concurrent bids, settlement and backpack claims", async () => {
        const listing = await auctions.createAuction(ids[0], { kind: "item", key: "wild_berries", quantity: 2, title: "Berries", description: "", price: 100, hours: 2 });
        const stock = await db.pool.query("SELECT quantity FROM player_items WHERE player_id=$1 AND item_key='wild_berries'", [ids[0]]);
        expect(stock.rows[0].quantity).toBe(18);
        const attempts = await Promise.allSettled([auctions.bidAuction(listing.id, ids[1], 100), auctions.bidAuction(listing.id, ids[2], 100)]);
        expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
        const first = await auctions.auctionDetail(listing.id);
        const winner = first.high_bidder === ids[1] ? ids[2] : ids[1];
        await auctions.bidAuction(listing.id, winner, 105);
        await auctions.bidAuction(listing.id, winner, 111);
        expect((await Player.findById(winner))?.balance).toBe(9889);
        expect((await Player.findById(first.high_bidder))?.balance).toBe(10000);
        await auctions.endAuction(listing.id, ids[0]);
        expect((await Player.findById(ids[0]))?.balance).toBe(10101);
        const account = await auctions.auctionAccount(winner);
        expect(account.claims).toHaveLength(1);
        await db.pool.query("INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,'wild_berries',9)", [winner]);
        await expect(auctions.claimAuction(account.claims[0].id, winner)).rejects.toThrow("backpack space");
        await db.pool.query("DELETE FROM player_items WHERE player_id=$1", [winner]);
        await auctions.claimAuction(account.claims[0].id, winner);
        await expect(auctions.claimAuction(account.claims[0].id, winner)).rejects.toThrow("Claim not found");
        expect((await db.pool.query("SELECT quantity FROM player_items WHERE player_id=$1", [winner])).rows[0].quantity).toBe(2);
    });

    test("ends an unpaid listing, awards its highest bid, and records seller notification", async () => {
        const listing = await auctions.createAuction(ids[0], { kind: "item", key: "wild_berries", quantity: 1, title: "Fee test", description: "", price: 100, hours: 48 });
        await auctions.bidAuction(listing.id, ids[1], 100);
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','0'::jsonb) WHERE id=$1", [ids[0]]);
        await db.pool.query("UPDATE auctions SET next_fee_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [listing.id]);
        await auctions.tickAuctions();
        expect((await auctions.auctionDetail(listing.id)).status).toBe("ended");
        expect((await auctions.auctionAccount(ids[0])).notifications.some(n => n.message.includes("daily listing fee"))).toBe(true);
        expect((await auctions.auctionAccount(ids[1])).claims.some(c => c.auction_id === listing.id)).toBe(true);
    });

    test("limits promotions to three and refunds unused time to the displaced seller", async () => {
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','10000'::jsonb) WHERE id=$1", [ids[0]]);
        const listings = [];
        for (let i = 0; i < 4; i++) listings.push(await auctions.createAuction(ids[0], { kind: "item", key: "wild_berries", quantity: 1, title: `Ad ${i}`, description: "", price: 100, hours: 48 }));
        for (let i = 0; i < 3; i++) await auctions.promoteAuction(listings[i].id, ids[0], 100 + i);
        await expect(auctions.promoteAuction(listings[3].id, ids[0], 100)).rejects.toThrow("Minimum promotion payment");
        const before = (await Player.findById(ids[0]))!.balance;
        await auctions.promoteAuction(listings[3].id, ids[0], 101);
        const after = (await Player.findById(ids[0]))!.balance;
        expect(after).toBeGreaterThanOrEqual(before - 2);
        const promoted = await db.pool.query("SELECT count(*)::int AS count FROM auctions WHERE status='active' AND promotion_ends_at > now()");
        expect(promoted.rows[0].count).toBe(3);
    });

    test("commits settlement even when a late bid is rejected", async () => {
        const listing = await auctions.createAuction(ids[0], { kind: "item", key: "wild_berries", quantity: 1, title: "Expired", description: "", price: 100, hours: 2 });
        await db.pool.query("UPDATE auctions SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [listing.id]);
        await expect(auctions.bidAuction(listing.id, ids[1], 100)).rejects.toThrow("Auction has ended");
        expect((await db.pool.query("SELECT status FROM auctions WHERE id=$1", [listing.id])).rows[0].status).toBe("ended");
        expect((await auctions.auctionAccount(ids[0])).claims.some(c => c.auction_id === listing.id)).toBe(true);
    });

    test("preserves item and companion circulation in escrow and after claim", async () => {
        const { getItemCirculation } = await import("../src/itemStorage.js");
        const { getCompanionCirculation } = await import("../src/companionStorage.js");
        await db.pool.query("INSERT INTO player_companions (player_id,companion_key,quantity) VALUES ($1,'pebblepup',1)", [ids[0]]);
        await db.pool.query("UPDATE players SET data=data || $2::jsonb WHERE id=$1", [ids[0], JSON.stringify({ equippedCompanions: ["pebblepup"], equippedCompanion: "pebblepup" })]);
        const itemsBefore = (await getItemCirculation()).get("wild_berries");
        const companionsBefore = (await getCompanionCirculation()).find(c => c.key === "pebblepup")?.quantity;
        const item = await auctions.createAuction(ids[0], { kind: "item", key: "wild_berries", quantity: 1, title: "Item", description: "", price: 100, hours: 2 });
        const companion = await auctions.createAuction(ids[0], { kind: "companion", key: "pebblepup", quantity: 1, title: "Companion", description: "", price: 100, hours: 2 });
        expect((await auctions.auctionDetail(companion.id)).asset.name).toBe("Pebblepup");
        expect((await db.pool.query("SELECT data->'equippedCompanions' AS equipment FROM players WHERE id=$1", [ids[0]])).rows[0].equipment).toEqual([]);
        expect((await getItemCirculation()).get("wild_berries")).toBe(itemsBefore);
        expect((await getCompanionCirculation()).find(c => c.key === "pebblepup")?.quantity).toBe(companionsBefore);
        await auctions.endAuction(item.id, ids[0]);
        await auctions.endAuction(companion.id, ids[0]);
        expect((await getItemCirculation()).get("wild_berries")).toBe(itemsBefore);
        expect((await getCompanionCirculation()).find(c => c.key === "pebblepup")?.quantity).toBe(companionsBefore);
        const claims = (await auctions.auctionAccount(ids[0])).claims;
        const companionClaim = claims.find(c => c.auction_id === companion.id);
        await auctions.claimAuction(companionClaim.id, ids[0]);
        expect((await getCompanionCirculation()).find(c => c.key === "pebblepup")?.quantity).toBe(companionsBefore);
    });

    test("transfers unopened lootboxes and unused boosts with their details", async () => {
        const box = await db.pool.query("INSERT INTO player_lootboxes (player_id,rarity) VALUES ($1,'rare') RETURNING id::text", [ids[0]]);
        const boost = await db.pool.query("INSERT INTO player_lootbox_boosts (player_id,bonus_type,multiplier,duration_minutes) VALUES ($1,'experience',1.5,30) RETURNING id::text", [ids[0]]);
        for (const [kind, key] of [["lootbox", box.rows[0].id], ["boost", boost.rows[0].id]] as const) {
            const listing = await auctions.createAuction(ids[0], { kind, key, quantity: 1, title: kind, description: "", price: 100, hours: 2 });
            expect((await auctions.auctionDetail(listing.id)).asset.name).toBeTruthy();
            await auctions.bidAuction(listing.id, ids[2], 100);
            await auctions.endAuction(listing.id, ids[0]);
            const claim = (await auctions.auctionAccount(ids[2])).claims.find(c => c.auction_id === listing.id);
            await auctions.claimAuction(claim.id, ids[2]);
        }
        expect((await db.pool.query("SELECT rarity FROM player_lootboxes WHERE player_id=$1", [ids[2]])).rows).toContainEqual({ rarity: "rare" });
        expect((await db.pool.query("SELECT bonus_type,multiplier,duration_minutes FROM player_lootbox_boosts WHERE player_id=$1", [ids[2]])).rows).toContainEqual({ bonus_type: "experience", multiplier: 1.5, duration_minutes: 30 });
    });

    test("unequips a listed tool and refuses a lootbox with a pending reward", async () => {
        await db.pool.query("INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,'iron_pick',1)", [ids[0]]);
        await db.pool.query("INSERT INTO player_scavenge_state (player_id,equipped_tools) VALUES ($1,ARRAY['iron_pick']) ON CONFLICT (player_id) DO UPDATE SET equipped_tools=ARRAY['iron_pick']", [ids[0]]);
        const tool = await auctions.createAuction(ids[0], { kind: "item", key: "iron_pick", quantity: 1, title: "Pick", description: "", price: 100, hours: 2 });
        expect((await db.pool.query("SELECT equipped_tools FROM player_scavenge_state WHERE player_id=$1", [ids[0]])).rows[0].equipped_tools).toEqual([]);
        await auctions.endAuction(tool.id, ids[0]);
        const box = await db.pool.query("INSERT INTO player_lootboxes (player_id,rarity,pending_reward) VALUES ($1,'rare','{}'::jsonb) RETURNING id::text", [ids[0]]);
        const balance = (await Player.findById(ids[0]))!.balance;
        await expect(auctions.createAuction(ids[0], { kind: "lootbox", key: box.rows[0].id, quantity: 1, title: "Box", description: "", price: 100, hours: 2 })).rejects.toThrow("pending reward");
        expect((await Player.findById(ids[0]))!.balance).toBe(balance);
        expect((await db.pool.query("SELECT id FROM player_lootboxes WHERE id=$1", [box.rows[0].id])).rowCount).toBe(1);
    });

    test("makes listings beyond the first page accessible", async () => {
        await db.pool.query(`INSERT INTO auctions (seller_id,asset,title,description,starting_price,daily_fee,ends_at,next_fee_at)
            SELECT $1,'{"kind":"item","key":"wild_berries","name":"Wild Berries","quantity":1}'::jsonb,
            'Pagination test','',100,10,clock_timestamp()+interval '2 hours',clock_timestamp()+interval '24 hours'
            FROM generate_series(1,51)`, [ids[0]]);
        const first = await auctions.listAuctions(0);
        const second = await auctions.listAuctions(1);
        expect(first).toHaveLength(51);
        expect(second.length).toBeGreaterThan(0);
        expect(first.slice(0, 50).some(entry => entry.id === second[0].id)).toBe(false);
    });
});
