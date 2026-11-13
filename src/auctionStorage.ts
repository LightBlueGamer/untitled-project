import type { PoolClient } from "pg";
import Player from "./classes/Player.js";
import { getPool } from "./database.js";
import { backpacks, items, ItemCategory, Tool } from "./resources/items.js";
import { getCompanion } from "./resources/companions.js";

type AssetKind = "item" | "companion" | "lootbox" | "boost";
interface Asset { kind: AssetKind; key: string; name: string; quantity: number; details?: Record<string, unknown> }
interface Auction {
    id: string; seller_id: string; asset: Asset; title: string; description: string;
    starting_price: string; high_bid: string | null; high_bidder: string | null;
    ends_at: Date; next_fee_at: Date; daily_fee: string; status: string;
    promoted_at: Date | null; promotion_ends_at: Date | null; promotion_price: string | null;
}

export class AuctionError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
}

export async function initializeAuctionStorage(): Promise<void> {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS auctions (
            id BIGSERIAL PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES players(id),
            asset JSONB NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
            starting_price BIGINT NOT NULL CHECK (starting_price > 0),
            high_bid BIGINT, high_bidder TEXT REFERENCES players(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            ends_at TIMESTAMPTZ NOT NULL, next_fee_at TIMESTAMPTZ NOT NULL,
            daily_fee BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
            promoted_at TIMESTAMPTZ, promotion_ends_at TIMESTAMPTZ, promotion_price BIGINT,
            CHECK (status IN ('active', 'ended'))
        );
        CREATE INDEX IF NOT EXISTS auctions_active_idx ON auctions (status, ends_at);
        CREATE TABLE IF NOT EXISTS auction_bids (
            id BIGSERIAL PRIMARY KEY, auction_id BIGINT NOT NULL REFERENCES auctions(id),
            bidder_id TEXT NOT NULL REFERENCES players(id), amount BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );
        CREATE TABLE IF NOT EXISTS auction_claims (
            id BIGSERIAL PRIMARY KEY, auction_id BIGINT NOT NULL UNIQUE REFERENCES auctions(id),
            player_id TEXT NOT NULL REFERENCES players(id), asset JSONB NOT NULL,
            claimed_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS auction_notifications (
            id BIGSERIAL PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
            message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            read_at TIMESTAMPTZ
        );
    `);
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    let committed = false;
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1097823944)");
        await processDue(client);
        await client.query("SAVEPOINT auction_operation");
        let result: T;
        try {
            result = await operation(client);
        } catch (error) {
            if (!(error instanceof AuctionError)) throw error;
            await client.query("ROLLBACK TO SAVEPOINT auction_operation");
            await client.query("COMMIT");
            committed = true;
            throw error;
        }
        await client.query("COMMIT");
        committed = true;
        return result;
    } catch (error) {
        if (!committed) await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
}

async function money(client: PoolClient, id: string, delta: number): Promise<void> {
    const result = await client.query(
        `UPDATE players SET data = jsonb_set(data, '{balance}',
           to_jsonb(COALESCE((data->>'balance')::numeric, 0) + $2::numeric))
         WHERE id = $1 AND COALESCE((data->>'balance')::numeric, 0) + $2::numeric BETWEEN 0 AND 9007199254740991 RETURNING id`,
        [id, delta],
    );
    if (!result.rowCount) throw new AuctionError("Insufficient balance or balance limit exceeded.", 409);
}

async function notify(client: PoolClient, id: string, message: string): Promise<void> {
    await client.query("INSERT INTO auction_notifications (player_id, message) VALUES ($1, $2)", [id, message]);
}

async function refundPromotion(client: PoolClient, auction: Auction, now: Date): Promise<void> {
    if (!auction.promoted_at || !auction.promotion_ends_at || !auction.promotion_price) return;
    const remaining = Math.max(0, auction.promotion_ends_at.getTime() - now.getTime());
    const refund = Math.floor(Number(auction.promotion_price) * Math.min(1, remaining / 86400000));
    if (refund) {
        await money(client, auction.seller_id, refund);
        await notify(client, auction.seller_id, `Auction #${auction.id}: $${refund} refunded for unused promotion time.`);
    }
    await client.query("UPDATE auctions SET promoted_at = NULL, promotion_ends_at = NULL, promotion_price = NULL WHERE id = $1", [auction.id]);
}

async function settle(client: PoolClient, auction: Auction, reason: string, now: Date): Promise<void> {
    await refundPromotion(client, auction, now);
    const recipient = auction.high_bidder ?? auction.seller_id;
    if (auction.high_bidder && auction.high_bid) await money(client, auction.seller_id, Number(auction.high_bid));
    await client.query("INSERT INTO auction_claims (auction_id, player_id, asset) VALUES ($1, $2, $3::jsonb)",
        [auction.id, recipient, JSON.stringify(auction.asset)]);
    await client.query("UPDATE auctions SET status = 'ended' WHERE id = $1", [auction.id]);
    await notify(client, auction.seller_id, `Auction #${auction.id} ended ${reason}${auction.high_bidder ? `; the winning bid was $${auction.high_bid}.` : "; no bids were placed."}`);
    await notify(client, recipient, `Auction #${auction.id}: ${auction.high_bidder ? "You won" : "Your unsold listing was returned to"} your claims. Claim the asset in the Auction House.`);
}

async function processDue(client: PoolClient): Promise<void> {
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
    for (;;) {
        const rows = await client.query<Auction>(
            `SELECT a.* FROM auctions a WHERE status = 'active'
             AND (ends_at <= $1 OR next_fee_at <= $1) ORDER BY LEAST(ends_at, next_fee_at), a.id LIMIT 1 FOR UPDATE`, [now]);
        const auction = rows.rows[0];
        if (!auction) break;
        if (auction.next_fee_at <= now && auction.next_fee_at < auction.ends_at) {
            const result = await client.query(
                `UPDATE players SET data = jsonb_set(data, '{balance}', to_jsonb((data->>'balance')::numeric - $2::numeric))
                 WHERE id = $1 AND COALESCE((data->>'balance')::numeric, 0) >= $2 RETURNING id`,
                [auction.seller_id, auction.daily_fee]);
            if (!result.rowCount) {
                await settle(client, auction, "because the daily listing fee could not be paid", auction.next_fee_at);
                continue;
            }
            auction.next_fee_at = new Date(auction.next_fee_at.getTime() + 86400000);
            await client.query("UPDATE auctions SET next_fee_at = $2 WHERE id = $1", [auction.id, auction.next_fee_at]);
        } else {
            await settle(client, auction, "when its time expired", auction.ends_at);
        }
    }
}

export async function tickAuctions(): Promise<void> { await transaction(async () => {}); }

async function lockAuction(client: PoolClient, id: string): Promise<Auction> {
    const result = await client.query<Auction>("SELECT id::text, * FROM auctions WHERE id::text = $1 FOR UPDATE", [id]);
    if (!result.rows[0]) throw new AuctionError("Auction not found.", 404);
    return result.rows[0];
}

export async function auctionInventory(id: string) {
    const db = getPool();
    const [itemRows, companionRows, boxRows, boostRows] = await Promise.all([
        db.query<{ key: string; quantity: number }>("SELECT item_key AS key, quantity FROM player_items WHERE player_id = $1 ORDER BY item_key", [id]),
        db.query<{ key: string; quantity: number }>("SELECT companion_key AS key, quantity FROM player_companions WHERE player_id = $1 ORDER BY companion_key", [id]),
        db.query<{ id: string; rarity: string; pending_reward: unknown }>("SELECT id::text, rarity, pending_reward FROM player_lootboxes WHERE player_id = $1 ORDER BY id", [id]),
        db.query<{ id: string; bonus_type: string; multiplier: number; duration_minutes: number }>("SELECT id::text, bonus_type, multiplier, duration_minutes FROM player_lootbox_boosts WHERE player_id = $1 ORDER BY id", [id]),
    ]);
    return [
        ...itemRows.rows.filter(row => Object.hasOwn(items, row.key) && items[row.key].category !== ItemCategory.Backpack).map(row => ({ kind: "item", key: row.key, name: items[row.key].name, quantity: row.quantity })),
        ...companionRows.rows.filter(row => getCompanion(row.key)).map(row => ({ kind: "companion", key: row.key, name: getCompanion(row.key)!.name, quantity: row.quantity })),
        ...boxRows.rows.filter(row => !row.pending_reward).map(row => ({ kind: "lootbox", key: row.id, name: `${row.rarity} lootbox #${row.id}`, quantity: 1 })),
        ...boostRows.rows.map(row => ({ kind: "boost", key: row.id, name: `${row.bonus_type} ×${row.multiplier} for ${row.duration_minutes} min #${row.id}`, quantity: 1 })),
    ];
}

export async function createAuction(seller: string, input: { kind: AssetKind; key: string; quantity: number; title: string; description: string; price: number; hours: number }) {
    return transaction(async client => {
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [seller]);
        const fee = Math.max(10, Math.ceil(input.price / 100));
        await money(client, seller, -fee);
        let asset: Asset = { kind: input.kind, key: input.key, name: "", quantity: input.quantity };
        if (input.kind === "item" || input.kind === "companion") {
            const isItem = input.kind === "item";
            if (isItem ? !Object.hasOwn(items, input.key) || items[input.key].category === ItemCategory.Backpack : !getCompanion(input.key))
                throw new AuctionError("This asset cannot be listed.");
            asset.name = isItem ? items[input.key].name : getCompanion(input.key)!.name;
            const table = isItem ? "player_items" : "player_companions";
            const column = isItem ? "item_key" : "companion_key";
            const owned = await client.query<{ quantity: number }>(`SELECT quantity FROM ${table} WHERE player_id = $1 AND ${column} = $2 FOR UPDATE`, [seller, input.key]);
            if (!owned.rows[0] || owned.rows[0].quantity < input.quantity) throw new AuctionError("Not enough assets owned.", 409);
            if (owned.rows[0].quantity === input.quantity) {
                await client.query(`DELETE FROM ${table} WHERE player_id = $1 AND ${column} = $2`, [seller, input.key]);
                if (isItem && items[input.key] instanceof Tool)
                    await client.query("UPDATE player_scavenge_state SET equipped_tools = array_remove(equipped_tools, $2) WHERE player_id = $1", [seller, input.key]);
                if (!isItem) {
                    const player = await Player.findById(seller, client);
                    if (!player) throw new AuctionError("Player not found.", 404);
                    const equipment = player.equippedCompanions.filter(key => key !== input.key);
                    await client.query(`UPDATE players SET data = jsonb_set(jsonb_set(data, '{equippedCompanions}', $2::jsonb), '{equippedCompanion}', COALESCE($2::jsonb->0, 'null'::jsonb)) WHERE id = $1`, [seller, JSON.stringify(equipment)]);
                }
            } else await client.query(`UPDATE ${table} SET quantity = quantity - $3 WHERE player_id = $1 AND ${column} = $2`, [seller, input.key, input.quantity]);
        } else {
            if (input.quantity !== 1) throw new AuctionError("List one lootbox or boost at a time.");
            if (input.kind === "lootbox") {
                const row = await client.query<{ rarity: string }>("DELETE FROM player_lootboxes WHERE player_id = $1 AND id::text = $2 AND pending_reward IS NULL RETURNING rarity", [seller, input.key]);
                if (!row.rows[0]) throw new AuctionError("Lootbox not found or has a pending reward.", 409);
                asset = { ...asset, name: `${row.rows[0].rarity} lootbox`, details: row.rows[0] };
            } else {
                const row = await client.query<{ bonus_type: string; multiplier: number; duration_minutes: number }>("DELETE FROM player_lootbox_boosts WHERE player_id = $1 AND id::text = $2 RETURNING bonus_type, multiplier, duration_minutes", [seller, input.key]);
                if (!row.rows[0]) throw new AuctionError("Boost not found.", 409);
                asset = { ...asset, name: `${row.rows[0].bonus_type} ×${row.rows[0].multiplier} for ${row.rows[0].duration_minutes} min`, details: row.rows[0] };
            }
        }
        const result = await client.query<{ id: string }>(
            `INSERT INTO auctions (seller_id, asset, title, description, starting_price, daily_fee, ends_at, next_fee_at)
             VALUES ($1,$2::jsonb,$3,$4,$5,$6,clock_timestamp()+$7*interval '1 hour',clock_timestamp()+interval '24 hours') RETURNING id::text`,
            [seller, JSON.stringify(asset), input.title, input.description, input.price, fee, input.hours]);
        return result.rows[0];
    });
}

export async function bidAuction(id: string, bidder: string, amount: number) {
    return transaction(async client => {
        const auction = await lockAuction(client, id);
        if (auction.status !== "active") throw new AuctionError("Auction has ended.", 409);
        if (auction.seller_id === bidder) throw new AuctionError("You cannot bid on your own listing.", 409);
        const current = Number(auction.high_bid ?? 0);
        const minimum = current ? current + Math.max(1, Math.ceil(current * .05)) : Number(auction.starting_price);
        if (amount < minimum) throw new AuctionError(`Minimum bid is $${minimum}.`, 409);
        const additional = auction.high_bidder === bidder ? amount - current : amount;
        await money(client, bidder, -additional);
        if (auction.high_bidder && auction.high_bidder !== bidder) {
            await money(client, auction.high_bidder, current);
            await notify(client, auction.high_bidder, `You were outbid on auction #${id}; your $${current} bid was refunded.`);
        }
        await client.query("UPDATE auctions SET high_bid = $2, high_bidder = $3 WHERE id = $1", [id, amount, bidder]);
        await client.query("INSERT INTO auction_bids (auction_id, bidder_id, amount) VALUES ($1,$2,$3)", [id, bidder, amount]);
    });
}

export async function endAuction(id: string, seller: string) {
    return transaction(async client => {
        const auction = await lockAuction(client, id);
        if (auction.seller_id !== seller) throw new AuctionError("Only the seller can end this auction.", 403);
        if (auction.status !== "active") throw new AuctionError("Auction has ended.", 409);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
        await settle(client, auction, "early by the seller", now);
    });
}

export async function promoteAuction(id: string, seller: string, offered: number) {
    return transaction(async client => {
        const auction = await lockAuction(client, id);
        if (auction.seller_id !== seller) throw new AuctionError("Only the seller can promote this listing.", 403);
        if (auction.status !== "active") throw new AuctionError("Auction has ended.", 409);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;
        const promoted = await client.query<Auction>("SELECT a.* FROM auctions a WHERE status='active' AND promotion_ends_at > $1 ORDER BY promotion_price, a.id FOR UPDATE", [now]);
        if (promoted.rows.some(row => row.id === id)) throw new AuctionError("This listing is already promoted.", 409);
        const minimum = Math.max(100, Math.ceil(Number(auction.starting_price) / 100), promoted.rows.length >= 3 ? Number(promoted.rows[0].promotion_price) + 1 : 0);
        if (offered < minimum) throw new AuctionError(`Minimum promotion payment is $${minimum}.`, 409);
        await money(client, seller, -offered);
        if (promoted.rows.length >= 3) await refundPromotion(client, promoted.rows[0], now);
        await client.query("UPDATE auctions SET promoted_at=$3, promotion_ends_at=$3::timestamptz+interval '24 hours', promotion_price=$2 WHERE id=$1", [id, offered, now]);
    });
}

export async function claimAuction(id: string, user: string) {
    return transaction(async client => {
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [user]);
        const result = await client.query<{ asset: Asset }>("SELECT asset FROM auction_claims WHERE id::text=$1 AND player_id=$2 AND claimed_at IS NULL FOR UPDATE", [id, user]);
        const asset = result.rows[0]?.asset;
        if (!asset) throw new AuctionError("Claim not found.", 404);
        if (asset.kind === "item") {
            const capacity = await client.query<{ backpack_key: string; used: string }>(`SELECT COALESCE(s.backpack_key,'small_pouch') AS backpack_key, (SELECT COALESCE(SUM(quantity),0)::text FROM player_items WHERE player_id=$1) AS used FROM players p LEFT JOIN player_scavenge_state s ON s.player_id=p.id WHERE p.id=$1`, [user]);
            const backpack = backpacks[capacity.rows[0].backpack_key];
            if (!backpack) throw new Error("Unknown equipped backpack");
            if (Number(capacity.rows[0].used) + asset.quantity > backpack.capacity) throw new AuctionError("Not enough backpack space. Free space and try again.", 409);
            await client.query("INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,$2,$3) ON CONFLICT (player_id,item_key) DO UPDATE SET quantity=player_items.quantity+EXCLUDED.quantity", [user, asset.key, asset.quantity]);
        } else if (asset.kind === "companion") {
            await client.query("INSERT INTO player_companions (player_id,companion_key,quantity) VALUES ($1,$2,$3) ON CONFLICT (player_id,companion_key) DO UPDATE SET quantity=player_companions.quantity+EXCLUDED.quantity", [user, asset.key, asset.quantity]);
        } else if (asset.kind === "lootbox") {
            await client.query("INSERT INTO player_lootboxes (player_id,rarity) VALUES ($1,$2)", [user, asset.details?.rarity]);
        } else {
            await client.query("INSERT INTO player_lootbox_boosts (player_id,bonus_type,multiplier,duration_minutes) VALUES ($1,$2,$3,$4)", [user, asset.details?.bonus_type, asset.details?.multiplier, asset.details?.duration_minutes]);
        }
        await client.query("UPDATE auction_claims SET claimed_at=clock_timestamp() WHERE id::text=$1", [id]);
    });
}

export async function listAuctions(page = 0) {
    return transaction(async client => {
        return (await client.query(`SELECT a.id::text, a.seller_id, COALESCE(p.data->>'name',a.seller_id) AS seller_name,
            a.asset, a.title, a.description, a.starting_price::text, a.high_bid::text, a.high_bidder,
            a.ends_at, a.status, a.promotion_ends_at, a.promotion_price::text
            FROM auctions a JOIN players p ON p.id=a.seller_id WHERE a.status='active'
            ORDER BY CASE WHEN a.promotion_ends_at > clock_timestamp() THEN 0 ELSE 1 END,
            CASE WHEN a.promotion_ends_at > clock_timestamp() THEN a.promotion_price END DESC NULLS LAST, a.created_at DESC, a.id DESC
            LIMIT 51 OFFSET $1`, [page * 50])).rows;
    });
}

export async function auctionDetail(id: string) {
    return transaction(async client => {
        const result = await client.query(`SELECT a.id::text,a.seller_id,COALESCE(p.data->>'name',a.seller_id) AS seller_name,
            a.asset,a.title,a.description,a.starting_price::text,a.high_bid::text,a.high_bidder,a.ends_at,a.status,
            a.daily_fee::text,a.next_fee_at,a.promotion_ends_at,a.promotion_price::text
            FROM auctions a JOIN players p ON p.id=a.seller_id WHERE a.id::text=$1`, [id]);
        if (!result.rows[0]) throw new AuctionError("Auction not found.", 404);
        const bids = await client.query(`SELECT b.bidder_id,COALESCE(p.data->>'name',b.bidder_id) AS bidder_name,b.amount::text,b.created_at
            FROM auction_bids b JOIN players p ON p.id=b.bidder_id WHERE b.auction_id::text=$1 ORDER BY b.id DESC LIMIT 200`, [id]);
        return { ...result.rows[0], bids: bids.rows };
    });
}

export async function auctionAccount(user: string) {
    return transaction(async client => {
        const claims = await client.query("SELECT id::text, auction_id::text, asset FROM auction_claims WHERE player_id=$1 AND claimed_at IS NULL ORDER BY id", [user]);
        const notifications = await client.query("SELECT id::text,message,created_at,read_at FROM auction_notifications WHERE player_id=$1 ORDER BY id DESC LIMIT 100", [user]);
        return { claims: claims.rows, notifications: notifications.rows };
    });
}

export async function readAuctionNotifications(user: string) {
    await getPool().query("UPDATE auction_notifications SET read_at=clock_timestamp() WHERE player_id=$1 AND read_at IS NULL", [user]);
}
