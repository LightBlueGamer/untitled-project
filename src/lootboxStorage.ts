import type { PoolClient } from "pg";
import Player from "./classes/Player.js";
import { getPool } from "./database.js";
import { backpacks, items, ItemCategory } from "./resources/items.js";
import { getCompanion } from "./resources/companions.js";
import { Rarity } from "./resources/rarities.js";
import { rollLootboxReward, type LootboxBoostType, type LootboxReward } from "./resources/lootboxes.js";

export interface OwnedLootbox {
    id: string;
    rarity: Rarity;
    pending_reward: LootboxReward | null;
}

export interface OwnedLootboxBoost {
    id: string;
    bonus_type: LootboxBoostType;
    multiplier: number;
    duration_minutes: number;
}

async function invalidate(playerId: string): Promise<void> {
    try {
        await Player.invalidate(playerId);
    } catch (error) {
        console.error("Failed to invalidate player cache after lootbox update:", error);
    }
}

export async function savePlayerWithLootbox(player: Player, rarity: Rarity): Promise<void> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await player.save(client);
        await client.query("INSERT INTO player_lootboxes (player_id, rarity) VALUES ($1, $2)", [player.id, rarity]);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    await invalidate(player.id);
}

export async function getLootboxInventory(playerId: string): Promise<{ boxes: OwnedLootbox[]; boosts: OwnedLootboxBoost[] }> {
    const [boxes, boosts] = await Promise.all([
        getPool().query<OwnedLootbox>(
            "SELECT id::text, rarity, pending_reward FROM player_lootboxes WHERE player_id = $1 ORDER BY id", [playerId],
        ),
        getPool().query<OwnedLootboxBoost>(
            "SELECT id::text, bonus_type, multiplier, duration_minutes FROM player_lootbox_boosts WHERE player_id = $1 ORDER BY id", [playerId],
        ),
    ]);
    return { boxes: boxes.rows, boosts: boosts.rows };
}

async function activeMultiplier(client: PoolClient, playerId: string, type: LootboxBoostType): Promise<number> {
    const result = await client.query<{ multiplier: number }>(
        "SELECT multiplier FROM player_item_bonuses WHERE player_id = $1 AND bonus_type = $2 AND expires_at > now()",
        [playerId, type],
    );
    return result.rows[0]?.multiplier ?? 1;
}

export async function getLootboxBonuses(playerId: string): Promise<Record<LootboxBoostType, number>> {
    const result = await getPool().query<{ bonus_type: LootboxBoostType; multiplier: number }>(
        "SELECT bonus_type, multiplier FROM player_item_bonuses WHERE player_id = $1 AND bonus_type = ANY($2::text[]) AND expires_at > now()",
        [playerId, ["lootboxDrop", "lootboxRarity", "lootboxReward", "lootboxFind"]],
    );
    const bonuses: Record<LootboxBoostType, number> = { lootboxDrop: 1, lootboxRarity: 1, lootboxReward: 1, lootboxFind: 1 };
    for (const row of result.rows) bonuses[row.bonus_type] = row.multiplier;
    return bonuses;
}

export async function openLootbox(playerId: string, id: string, random: () => number = Math.random):
    Promise<{ status: "opened"; reward: LootboxReward } | { status: "full" } | { status: "missing" }> {
    if (!/^[1-9]\d*$/.test(id)) return { status: "missing" };
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const locked = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!locked.rowCount) throw new Error("Player record not found");
        const player = await Player.findById(playerId, client);
        if (!player) throw new Error("Player record not found");
        const box = await client.query<OwnedLootbox>(
            "SELECT id::text, rarity, pending_reward FROM player_lootboxes WHERE player_id = $1 AND id::text = $2 FOR UPDATE", [playerId, id],
        );
        if (!box.rows[0]) {
            await client.query("ROLLBACK");
            return { status: "missing" };
        }
        const row = box.rows[0];
        const reward = row.pending_reward ?? rollLootboxReward(row.rarity,
            player.lootboxRewardMultiplier * await activeMultiplier(client, playerId, "lootboxReward"),
            player.lootboxFindMultiplier * await activeMultiplier(client, playerId, "lootboxFind"), random);
        if (reward.type === "item") {
            if (!Object.hasOwn(items, reward.key) || items[reward.key].category === ItemCategory.Backpack) {
                throw new Error(`Unknown lootbox item reward ${reward.key}`);
            }
            const capacity = await client.query<{ backpack_key: string; used: string }>(
                `SELECT COALESCE(s.backpack_key, 'small_pouch') AS backpack_key,
                    (SELECT COALESCE(SUM(quantity), 0)::text FROM player_items WHERE player_id = $1) AS used
                 FROM players p LEFT JOIN player_scavenge_state s ON s.player_id = p.id WHERE p.id = $1`,
                [playerId],
            );
            const backpack = backpacks[capacity.rows[0].backpack_key];
            if (!backpack) throw new Error("Unknown equipped backpack");
            if (Number(capacity.rows[0].used) >= backpack.capacity) {
                await client.query("UPDATE player_lootboxes SET pending_reward = $2::jsonb WHERE id::text = $1",
                    [id, JSON.stringify(reward)]);
                await client.query("COMMIT");
                return { status: "full" };
            }
            await client.query(
                `INSERT INTO player_items (player_id, item_key, quantity) VALUES ($1, $2, 1)
                 ON CONFLICT (player_id, item_key) DO UPDATE SET quantity = player_items.quantity + 1`,
                [playerId, reward.key],
            );
        } else if (reward.type === "companion") {
            if (!getCompanion(reward.key)) throw new Error(`Unknown lootbox companion reward ${reward.key}`);
            await client.query(
                `INSERT INTO player_companions (player_id, companion_key, quantity) VALUES ($1, $2, 1)
                 ON CONFLICT (player_id, companion_key) DO UPDATE SET quantity = player_companions.quantity + 1`,
                [playerId, reward.key],
            );
        } else {
            await client.query(
                `INSERT INTO player_lootbox_boosts (player_id, bonus_type, multiplier, duration_minutes)
                 VALUES ($1, $2, $3, $4)`, [playerId, reward.bonus, reward.multiplier, reward.durationMinutes],
            );
        }
        await client.query("DELETE FROM player_lootboxes WHERE id::text = $1 AND player_id = $2", [id, playerId]);
        await client.query("COMMIT");
        if (reward.type === "companion") await invalidate(playerId);
        return { status: "opened", reward };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function useLootboxBoost(playerId: string, id: string): Promise<OwnedLootboxBoost | null> {
    if (!/^[1-9]\d*$/.test(id)) return null;
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const player = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!player.rowCount) throw new Error("Player record not found");
        const result = await client.query<OwnedLootboxBoost>(
            `DELETE FROM player_lootbox_boosts WHERE player_id = $1 AND id::text = $2
             RETURNING id::text, bonus_type, multiplier, duration_minutes`, [playerId, id],
        );
        const boost = result.rows[0];
        if (!boost) {
            await client.query("ROLLBACK");
            return null;
        }
        await client.query(
            `INSERT INTO player_item_bonuses (player_id, bonus_type, multiplier, expires_at)
             VALUES ($1, $2, $3, now() + ($4 * interval '1 minute'))
             ON CONFLICT (player_id, bonus_type) DO UPDATE SET
               multiplier = CASE WHEN player_item_bonuses.expires_at > now()
                   THEN player_item_bonuses.multiplier * EXCLUDED.multiplier ELSE EXCLUDED.multiplier END,
               expires_at = GREATEST(player_item_bonuses.expires_at, now()) + ($4 * interval '1 minute')`,
            [playerId, boost.bonus_type, boost.multiplier, boost.duration_minutes],
        );
        await client.query("COMMIT");
        return boost;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
