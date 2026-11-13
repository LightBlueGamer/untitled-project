import type { PoolClient } from "pg";
import { getPool } from "./database.js";
import { getItemCirculation } from "./itemStorage.js";
import { backpacks, items, ItemCategory, type Item } from "./resources/items.js";
import { Rarity } from "./resources/rarities.js";

const rarityRules: Record<Rarity, { base: number; alpha: number; appearance: number }> = {
    [Rarity.Common]: { base: 10, alpha: 1.6, appearance: 0.65 },
    [Rarity.Uncommon]: { base: 7, alpha: 1.9, appearance: 0.48 },
    [Rarity.Rare]: { base: 5, alpha: 2.2, appearance: 0.32 },
    [Rarity.Epic]: { base: 2, alpha: 2.5, appearance: 0.2 },
    [Rarity.Legendary]: { base: 1, alpha: 2.8, appearance: 0.12 },
    [Rarity.Mythic]: { base: -1, alpha: 3.1, appearance: 0.08 },
    [Rarity.Eternal]: { base: -3, alpha: 3.4, appearance: 0.05 },
};
const maxStock = 2_147_483_647;

export class BotShopError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
}

export function shopQuantity(rarity: Rarity, random: () => number = Math.random): number {
    const { base, alpha } = rarityRules[rarity];
    const extras = Math.min(maxStock - Math.max(base, 0), Math.floor(3 * ((1 - random()) ** (-1 / alpha) - 1)));
    return Math.max(0, base + extras);
}

export function shopAppearanceChance(rarity: Rarity, circulation: number): number {
    return rarityRules[rarity].appearance / Math.sqrt(1 + Math.max(0, circulation) / 50);
}

export function shopPrice(item: Item, circulation: number, random: () => number = Math.random): number {
    const scarcity = 1 / (1 + Math.max(0, circulation) / 100);
    const multiplier = 2.5 + 97.5 * (1 - random() ** (2 + 1.5 * scarcity));
    return Math.max(1, Math.round(item.price * multiplier));
}

export function selectShopItems<T extends { item: Item; count: number }>(candidates: readonly T[], random: () => number = Math.random): T[] {
    const remaining = [...candidates];
    const selected: T[] = [];
    while (remaining.length && (selected.length === 0 || random() < 0.9 / (1 + 0.12 * (selected.length - 1)))) {
        const total = remaining.reduce((sum, candidate) => sum + shopAppearanceChance(candidate.item.rarity, candidate.count), 0);
        let roll = random() * total;
        const index = remaining.findIndex(candidate => {
            roll -= shopAppearanceChance(candidate.item.rarity, candidate.count);
            return roll < 0;
        });
        if (index < 0) throw new Error("Could not select a bot shop item");
        selected.push(remaining.splice(index, 1)[0]);
    }
    return selected;
}

export async function initializeBotShop(): Promise<void> {
    await getPool().query(`
        CREATE TABLE IF NOT EXISTS bot_shop_state (
            singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
            generation BIGINT NOT NULL DEFAULT 0,
            refreshed_at TIMESTAMPTZ NOT NULL,
            next_refresh_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bot_shop_stock (
            item_key TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK (quantity >= 0),
            price BIGINT NOT NULL CHECK (price > 0)
        );
        CREATE TABLE IF NOT EXISTS bot_shop_purchases (
            id BIGSERIAL PRIMARY KEY, player_id TEXT NOT NULL, item_key TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            unit_price BIGINT NOT NULL CHECK (unit_price > 0),
            purchased_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        );
        CREATE INDEX IF NOT EXISTS bot_shop_purchases_time_idx ON bot_shop_purchases (purchased_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS bot_shop_alerts (
            player_id TEXT PRIMARY KEY, read_generation BIGINT NOT NULL
        )
    `);
}

async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1097823945)");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
}

async function regenerate(client: PoolClient): Promise<void> {
    const circulation = await getItemCirculation(client);
    const candidates = Object.entries(items).filter(([, item]) => item.category !== ItemCategory.Backpack && item.price > 0)
        .map(([key, item]) => {
            const count = Number(circulation.get(key) ?? 0);
            return { key, item, count, quantity: shopQuantity(item.rarity) };
        }).filter(candidate => candidate.quantity > 0);
    if (!candidates.length) throw new Error("Bot shop has no eligible items with stock");
    const selected = selectShopItems(candidates);
    await client.query("DELETE FROM bot_shop_stock");
    for (const candidate of selected) {
        await client.query("INSERT INTO bot_shop_stock (item_key, quantity, price) VALUES ($1,$2,$3)",
            [candidate.key, candidate.quantity, shopPrice(candidate.item, candidate.count)]);
    }
    await client.query(`INSERT INTO bot_shop_state (singleton,generation,refreshed_at,next_refresh_at)
        VALUES (true,1,clock_timestamp(),clock_timestamp()+interval '24 hours')
        ON CONFLICT (singleton) DO UPDATE SET generation=bot_shop_state.generation+1,
        refreshed_at=EXCLUDED.refreshed_at,next_refresh_at=EXCLUDED.next_refresh_at`);
    await client.query("DELETE FROM bot_shop_purchases WHERE purchased_at < clock_timestamp()-interval '30 days'");
}

async function ensureCurrent(client: PoolClient): Promise<void> {
    const state = await client.query<{ expired: boolean }>("SELECT next_refresh_at <= clock_timestamp() AS expired FROM bot_shop_state WHERE singleton");
    if (!state.rows[0] || state.rows[0].expired) await regenerate(client);
}

export async function refreshBotShop(): Promise<void> {
    await transaction(regenerate);
}

export async function tickBotShop(): Promise<void> {
    await transaction(ensureCurrent);
}

export async function botShopAlert(playerId: string) {
    return transaction(async client => {
        await ensureCurrent(client);
        const result = await client.query<{ generation: string; refreshed_at: Date; unread: boolean }>(
            `SELECT s.generation::text,s.refreshed_at, s.generation > COALESCE(a.read_generation,0) AS unread
             FROM bot_shop_state s LEFT JOIN bot_shop_alerts a ON a.player_id=$1 WHERE s.singleton`, [playerId]);
        return result.rows[0];
    });
}

export async function readBotShopAlert(playerId: string, generation: string): Promise<void> {
    await transaction(async client => {
        const state = await client.query<{ generation: string }>("SELECT generation::text FROM bot_shop_state WHERE singleton");
        if (!state.rows[0] || BigInt(generation) > BigInt(state.rows[0].generation)) throw new BotShopError("Invalid restock notification.", 400);
        await client.query(`INSERT INTO bot_shop_alerts (player_id,read_generation) VALUES ($1,$2)
            ON CONFLICT (player_id) DO UPDATE SET read_generation=GREATEST(bot_shop_alerts.read_generation,EXCLUDED.read_generation)`, [playerId, generation]);
    });
}

export async function getBotShopHistory(page: number) {
    const rows = await getPool().query<{ player_id: string; player_name: string; item_key: string; quantity: number; unit_price: string; total_price: string; purchased_at: Date }>(
        `SELECT b.player_id, COALESCE(p.data->>'name', b.player_id) AS player_name,
         b.item_key,b.quantity,b.unit_price::text,(b.unit_price * b.quantity)::text AS total_price,b.purchased_at
         FROM bot_shop_purchases b LEFT JOIN players p ON p.id=b.player_id
         WHERE b.purchased_at >= clock_timestamp()-interval '30 days'
         ORDER BY b.purchased_at DESC,b.id DESC LIMIT 51 OFFSET $1`, [page * 50]);
    return { hasMore: rows.rows.length > 50, entries: rows.rows.slice(0, 50).map(row => ({
        ...row, name: Object.hasOwn(items, row.item_key) ? items[row.item_key].name : row.item_key,
    })) };
}

export async function getBotShop() {
    return transaction(async client => {
        await ensureCurrent(client);
        const state = (await client.query<{ generation: string; next_refresh_at: Date }>(
            "SELECT generation::text,next_refresh_at FROM bot_shop_state WHERE singleton")).rows[0];
        const stock = await client.query<{ item_key: string; quantity: number; price: string }>(
            "SELECT item_key,quantity,price::text FROM bot_shop_stock ORDER BY item_key");
        return {
            generation: state.generation, nextRefreshAt: state.next_refresh_at,
            items: stock.rows.map(row => {
                const item = Object.hasOwn(items, row.item_key) ? items[row.item_key] : undefined;
                if (!item || item.category === ItemCategory.Backpack) throw new Error(`Unknown bot shop item ${row.item_key}`);
                return { key: row.item_key, name: item.name, description: item.description, rarity: item.rarity,
                    category: item.category, basePrice: item.price, price: Number(row.price), quantity: row.quantity };
            }),
        };
    });
}

export async function buyBotShopItem(playerId: string, key: string, quantity: number, generation: string): Promise<void> {
    const error = await transaction(async client => {
        await ensureCurrent(client);
        const state = await client.query<{ generation: string }>("SELECT generation::text FROM bot_shop_state WHERE singleton");
        if (state.rows[0].generation !== generation) return new BotShopError("The shop has restocked. Refresh and check the new price.", 409);
        const item = Object.hasOwn(items, key) ? items[key] : undefined;
        if (!item || item.category === ItemCategory.Backpack) throw new BotShopError("Item not available.", 404);
        const stock = await client.query<{ quantity: number; price: string }>("SELECT quantity,price::text FROM bot_shop_stock WHERE item_key=$1 FOR UPDATE", [key]);
        if (!stock.rows[0] || stock.rows[0].quantity < quantity) throw new BotShopError("Not enough stock available.", 409);
        const cost = Number(stock.rows[0].price) * quantity;
        if (!Number.isSafeInteger(cost)) throw new BotShopError("Purchase total is too large.", 400);
        const player = await client.query<{ data: { balance?: number } }>("SELECT data FROM players WHERE id=$1 FOR UPDATE", [playerId]);
        if (!player.rows[0]) throw new BotShopError("Player not found. Play the bot first to create a character.", 404);
        const capacity = await client.query<{ backpack_key: string; used: string }>(
            `SELECT COALESCE(s.backpack_key,'small_pouch') AS backpack_key,
             (SELECT COALESCE(SUM(quantity),0)::text FROM player_items WHERE player_id=$1) AS used
             FROM players p LEFT JOIN player_scavenge_state s ON s.player_id=p.id WHERE p.id=$1`, [playerId]);
        const backpack = backpacks[capacity.rows[0].backpack_key];
        if (!backpack) throw new Error("Unknown equipped backpack");
        if (Number(capacity.rows[0].used) + quantity > backpack.capacity) throw new BotShopError("Not enough backpack space.", 409);
        if ((player.rows[0].data.balance ?? 0) < cost) throw new BotShopError("Not enough balance.", 409);
        await client.query("UPDATE players SET data=jsonb_set(data,'{balance}',to_jsonb((data->>'balance')::numeric-$2::numeric)) WHERE id=$1", [playerId, cost]);
        await client.query("UPDATE bot_shop_stock SET quantity=quantity-$2 WHERE item_key=$1", [key, quantity]);
        await client.query(`INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,$2,$3)
            ON CONFLICT (player_id,item_key) DO UPDATE SET quantity=player_items.quantity+EXCLUDED.quantity`, [playerId, key, quantity]);
        await client.query("INSERT INTO bot_shop_purchases (player_id,item_key,quantity,unit_price) VALUES ($1,$2,$3,$4)",
            [playerId, key, quantity, stock.rows[0].price]);
        return null;
    });
    if (error) throw error;
}
