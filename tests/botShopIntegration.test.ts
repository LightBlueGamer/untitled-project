import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.BOT_SHOP_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("Bot Shop PostgreSQL transactions", () => {
    let db: typeof import("../src/database.js");
    let shop: typeof import("../src/botShop.js");
    const ids = ["one", "two"].map(role => `shop-test-${randomUUID()}-${role}`);
    beforeAll(async () => {
        process.env.POSTGRES_URL = databaseUrl;
        process.env.REDIS_URL = "redis://127.0.0.1:1";
        db = await import("../src/database.js");
        shop = await import("../src/botShop.js");
        await db.initDatabase();
        for (const id of ids) await db.pool.query("INSERT INTO players (id,data) VALUES ($1,$2::jsonb)", [id, JSON.stringify({ name: id, balance: 10000 })]);
    });
    afterAll(async () => { await db.pool.end(); });

    test("generates a persistent nonempty stock and excludes backpacks", async () => {
        const first = await shop.getBotShop();
        const second = await shop.getBotShop();
        expect(first.items.length).toBeGreaterThan(0);
        expect(first.items.every(item => item.quantity > 0 && item.category !== "Backpack")).toBe(true);
        expect(second).toEqual(first);
    });

    test("serializes concurrent purchases, prevents overselling, and leaves sold-out stock visible", async () => {
        await db.pool.query("DELETE FROM bot_shop_stock");
        await db.pool.query("INSERT INTO bot_shop_stock (item_key,quantity,price) VALUES ('wild_berries',1,20)");
        const state = await shop.getBotShop();
        const outcomes = await Promise.allSettled(ids.map(id => shop.buyBotShopItem(id, "wild_berries", 1, state.generation)));
        expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
        const stock = await shop.getBotShop();
        expect(stock.items[0].quantity).toBe(0);
        const balances = await db.pool.query("SELECT (data->>'balance')::int AS balance FROM players WHERE id=ANY($1::text[]) ORDER BY id", [ids]);
        expect(balances.rows.map(row => row.balance).sort((a, b) => a - b)).toEqual([9980, 10000]);
        expect((await db.pool.query("SELECT SUM(quantity)::int AS count FROM player_items WHERE player_id=ANY($1::text[])", [ids])).rows[0].count).toBe(1);
        const history = await shop.getBotShopHistory(0);
        expect(history.entries).toHaveLength(1);
        expect(history.entries[0]).toMatchObject({ item_key: "wild_berries", quantity: 1, unit_price: "20", total_price: "20" });
    });

    test("rejects full backpacks and insufficient balances without changing stock", async () => {
        await db.pool.query("UPDATE bot_shop_stock SET quantity=2,price=20");
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','0'::jsonb) WHERE id=$1", [ids[0]]);
        const state = await shop.getBotShop();
        await expect(shop.buyBotShopItem(ids[0], "wild_berries", 1, state.generation)).rejects.toThrow("balance");
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{balance}','10000'::jsonb) WHERE id=$1", [ids[0]]);
        await db.pool.query("INSERT INTO player_items (player_id,item_key,quantity) VALUES ($1,'fieldstone',10) ON CONFLICT (player_id,item_key) DO UPDATE SET quantity=10", [ids[0]]);
        await expect(shop.buyBotShopItem(ids[0], "wild_berries", 1, state.generation)).rejects.toThrow("backpack");
        expect((await shop.getBotShop()).items[0].quantity).toBe(2);
        expect((await shop.getBotShopHistory(0)).entries).toHaveLength(1);
    });

    test("restocks once when overdue and rejects stale prices after a developer refresh", async () => {
        const original = await shop.getBotShop();
        await db.pool.query("UPDATE bot_shop_state SET next_refresh_at=clock_timestamp()-interval '1 second'");
        const updated = await shop.getBotShop();
        expect(BigInt(updated.generation)).toBe(BigInt(original.generation) + 1n);
        await shop.refreshBotShop();
        await expect(shop.buyBotShopItem(ids[1], updated.items[0].key, 1, updated.generation)).rejects.toThrow("restocked");
        expect(BigInt((await shop.getBotShop()).generation)).toBe(BigInt(updated.generation) + 1n);
    });

    test("commits an overdue restock when a purchase uses an expired generation", async () => {
        const old = await shop.getBotShop();
        await db.pool.query("UPDATE bot_shop_state SET next_refresh_at=clock_timestamp()-interval '1 second'");
        await expect(shop.buyBotShopItem(ids[1], old.items[0].key, 1, old.generation)).rejects.toThrow("restocked");
        expect(BigInt((await shop.getBotShop()).generation)).toBe(BigInt(old.generation) + 1n);
    });

    test("records purchases across restocks and excludes expired history", async () => {
        await db.pool.query("DELETE FROM bot_shop_stock");
        await db.pool.query("INSERT INTO bot_shop_stock (item_key,quantity,price) VALUES ('wild_berries',3,27)");
        await db.pool.query("DELETE FROM player_items WHERE player_id=$1", [ids[1]]);
        const generation = (await shop.getBotShop()).generation;
        await shop.buyBotShopItem(ids[1], "wild_berries", 2, generation);
        let history = await shop.getBotShopHistory(0);
        expect(history.entries[0]).toMatchObject({ player_id: ids[1], player_name: ids[1], item_key: "wild_berries", quantity: 2, unit_price: "27", total_price: "54" });
        await db.pool.query("UPDATE players SET data=jsonb_set(data,'{name}','\"New name\"'::jsonb) WHERE id=$1", [ids[1]]);
        expect((await shop.getBotShopHistory(0)).entries[0].player_name).toBe("New name");
        await shop.refreshBotShop();
        history = await shop.getBotShopHistory(0);
        expect(history.entries.some(row => row.player_id === ids[1] && row.unit_price === "27")).toBe(true);
        await db.pool.query("UPDATE bot_shop_purchases SET purchased_at=clock_timestamp()-interval '31 days' WHERE player_id=$1 AND unit_price=27", [ids[1]]);
        history = await shop.getBotShopHistory(0);
        expect(history.entries.some(row => row.unit_price === "27")).toBe(false);
    });

    test("keeps per-player alert read state and preserves newer restocks", async () => {
        const alert = await shop.botShopAlert(ids[0]);
        expect(alert.unread).toBe(true);
        await shop.readBotShopAlert(ids[0], alert.generation);
        expect((await shop.botShopAlert(ids[0])).unread).toBe(false);
        expect((await shop.botShopAlert(ids[1])).unread).toBe(true);
        await shop.refreshBotShop();
        await shop.readBotShopAlert(ids[0], alert.generation);
        expect((await shop.botShopAlert(ids[0])).unread).toBe(true);
        await expect(shop.readBotShopAlert(ids[0], "9999999999999999999")).rejects.toThrow("Invalid");
    });

    test("paginates purchases without including legacy price snapshots", async () => {
        await db.pool.query(`CREATE TABLE IF NOT EXISTS bot_shop_history (generation BIGINT, item_key TEXT, price BIGINT, refreshed_at TIMESTAMPTZ, sold_out_at TIMESTAMPTZ)`);
        await db.pool.query("INSERT INTO bot_shop_history VALUES (999,'fieldstone',99,now(),NULL)");
        await db.pool.query(`INSERT INTO bot_shop_purchases (player_id,item_key,quantity,unit_price)
            SELECT $1,'wild_berries',1,44 FROM generate_series(1,51)`, [ids[0]]);
        const first = await shop.getBotShopHistory(0);
        const next = await shop.getBotShopHistory(1);
        expect(first.entries).toHaveLength(50);
        expect(first.hasMore).toBe(true);
        expect(next.entries.length).toBeGreaterThan(0);
        expect([...first.entries, ...next.entries].some(entry => entry.item_key === "fieldstone")).toBe(false);
    });
});
