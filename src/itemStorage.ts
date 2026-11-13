import { getPool } from "./database.js";
import Player, { type ExperienceResult } from "./classes/Player.js";
import { BackpackUpgrade, backpacks, CraftableItem, describeToolBonus, getScavengeWeight, items, Tool, tools, type Item } from "./resources/items.js";
import { Rarity } from "./resources/rarities.js";
import type { PoolClient } from "pg";

export const scavengeCooldownMs = 5 * 60 * 1000;

export function getScavengeCooldownMs(player: Player): number {
    return Math.max(60_000, Math.floor(scavengeCooldownMs * player.scavengeCooldownMultiplier));
}

export interface OwnedItem {
    key: string;
    quantity: number;
}

export interface ActiveItemBonus {
    type: string;
    multiplier: number;
    expiresAt: string;
}

export interface ScavengeState {
    equippedTools: string[];
    nextScavengeAt: string | null;
    backpackKey: string;
}

export async function initializeItemStorage(): Promise<void> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1097823943)");
        await client.query(`
            CREATE TABLE IF NOT EXISTS player_items (
                player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                item_key TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                PRIMARY KEY (player_id, item_key)
            );
            CREATE TABLE IF NOT EXISTS player_scavenge_state (
                player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE RESTRICT,
                equipped_tools TEXT[] NOT NULL DEFAULT '{}',
                backpack_key TEXT NOT NULL DEFAULT 'small_pouch',
                next_scavenge_at TIMESTAMPTZ
            );
            ALTER TABLE player_scavenge_state ADD COLUMN IF NOT EXISTS backpack_key TEXT NOT NULL DEFAULT 'small_pouch';
            CREATE TABLE IF NOT EXISTS player_item_bonuses (
                player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                bonus_type TEXT NOT NULL,
                multiplier DOUBLE PRECISION NOT NULL CHECK (multiplier > 0),
                expires_at TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (player_id, bonus_type)
            );
            CREATE TABLE IF NOT EXISTS player_lootboxes (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                rarity TEXT NOT NULL,
                pending_reward JSONB
            );
            CREATE INDEX IF NOT EXISTS player_lootboxes_player_idx ON player_lootboxes (player_id, id);
            CREATE TABLE IF NOT EXISTS player_lootbox_boosts (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                bonus_type TEXT NOT NULL,
                multiplier DOUBLE PRECISION NOT NULL CHECK (multiplier > 1),
                duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0)
            );
            CREATE INDEX IF NOT EXISTS player_lootbox_boosts_player_idx ON player_lootbox_boosts (player_id, id);
            CREATE INDEX IF NOT EXISTS player_items_key_idx ON player_items (item_key);
        `);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getPlayerItems(playerId: string): Promise<OwnedItem[]> {
    const result = await getPool().query<{ item_key: string; quantity: number }>(
        "SELECT item_key, quantity FROM player_items WHERE player_id = $1 ORDER BY item_key",
        [playerId],
    );
    return result.rows.map(({ item_key, quantity }) => ({ key: item_key, quantity }));
}

export async function getItemCirculation(client: Pick<PoolClient, "query"> = getPool()): Promise<Map<string, string>> {
    const result = await client.query<{ item_key: string; quantity: string }>(
        `SELECT item_key, SUM(quantity)::text AS quantity FROM (
            SELECT item_key, quantity::bigint AS quantity FROM player_items
            UNION ALL
            SELECT asset->>'key' AS item_key, (asset->>'quantity')::bigint AS quantity
            FROM auctions WHERE status = 'active' AND asset->>'kind' = 'item'
            UNION ALL
            SELECT asset->>'key' AS item_key, (asset->>'quantity')::bigint AS quantity
            FROM auction_claims WHERE claimed_at IS NULL AND asset->>'kind' = 'item'
            UNION ALL
            SELECT COALESCE(s.backpack_key, 'small_pouch') AS item_key, 1::bigint AS quantity
            FROM players p LEFT JOIN player_scavenge_state s ON s.player_id = p.id
        ) inventory GROUP BY item_key`,
    );
    return new Map(result.rows.map(({ item_key, quantity }) => [item_key, quantity]));
}

export async function getPlayerScavengeState(playerId: string, toolSlots?: number): Promise<ScavengeState> {
    let equippedTools: string[] = [];
    let nextScavengeAt: Date | null = null;
    let backpackKey = "small_pouch";
    if (toolSlots === undefined) {
        const result = await getPool().query<{ equipped_tools: string[]; next_scavenge_at: Date | null; backpack_key: string }>(
            "SELECT equipped_tools, next_scavenge_at, backpack_key FROM player_scavenge_state WHERE player_id = $1",
            [playerId],
        );
        equippedTools = result.rows[0]?.equipped_tools ?? [];
        nextScavengeAt = result.rows[0]?.next_scavenge_at ?? null;
        backpackKey = result.rows[0]?.backpack_key ?? "small_pouch";
    } else {
        const client = await getPool().connect();
        try {
            await client.query("BEGIN");
            const result = await client.query<{ equipped_tools: string[]; next_scavenge_at: Date | null; backpack_key: string }>(
                "SELECT equipped_tools, next_scavenge_at, backpack_key FROM player_scavenge_state WHERE player_id = $1 FOR UPDATE",
                [playerId],
            );
            equippedTools = result.rows[0]?.equipped_tools ?? [];
            nextScavengeAt = result.rows[0]?.next_scavenge_at ?? null;
            backpackKey = result.rows[0]?.backpack_key ?? "small_pouch";
            if (equippedTools.length > toolSlots) {
                equippedTools = equippedTools.slice(0, toolSlots);
                await client.query(
                    "UPDATE player_scavenge_state SET equipped_tools = $2 WHERE player_id = $1",
                    [playerId, equippedTools],
                );
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
    return {
        equippedTools,
        nextScavengeAt: nextScavengeAt?.toISOString() ?? null,
        backpackKey,
    };
}

export async function getPlayerItemBonuses(playerId: string): Promise<ActiveItemBonus[]> {
    const result = await getPool().query<{ bonus_type: string; multiplier: number; expires_at: Date }>(
        `SELECT bonus_type, multiplier, expires_at
         FROM player_item_bonuses WHERE player_id = $1 AND expires_at > now()
         ORDER BY bonus_type`,
        [playerId],
    );
    return result.rows.map(({ bonus_type, multiplier, expires_at }) => ({
        type: bonus_type, multiplier, expiresAt: expires_at.toISOString(),
    }));
}

export async function equipPlayerTool(
    playerId: string,
    toolKey: string,
    toolSlots: number,
): Promise<"equipped" | "unowned" | "already-equipped" | "full"> {
    const tool = tools[toolKey];
    if (!tool) throw new Error(`Unknown tool ${toolKey}`);
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        const owned = await client.query(
            "SELECT 1 FROM player_items WHERE player_id = $1 AND item_key = $2 AND quantity > 0",
            [playerId, toolKey],
        );
        if (!owned.rowCount) {
            await client.query("ROLLBACK");
            return "unowned";
        }
        await client.query(
            "INSERT INTO player_scavenge_state (player_id) VALUES ($1) ON CONFLICT DO NOTHING",
            [playerId],
        );
        const result = await client.query<{ equipped_tools: string[] }>(
            "SELECT equipped_tools FROM player_scavenge_state WHERE player_id = $1 FOR UPDATE",
            [playerId],
        );
        const equipped = result.rows[0]?.equipped_tools ?? [];
        if (equipped.includes(toolKey)) {
            await client.query("ROLLBACK");
            return "already-equipped";
        }
        if (equipped.length >= toolSlots) {
            await client.query("ROLLBACK");
            return "full";
        }
        await client.query(
            "UPDATE player_scavenge_state SET equipped_tools = array_append(equipped_tools, $2) WHERE player_id = $1",
            [playerId, toolKey],
        );
        await client.query("COMMIT");
        return "equipped";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function unequipPlayerTool(
    playerId: string,
    toolKey: string,
): Promise<"unequipped" | "not-equipped"> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        const result = await client.query<{ equipped_tools: string[] }>(
            "SELECT equipped_tools FROM player_scavenge_state WHERE player_id = $1 FOR UPDATE",
            [playerId],
        );
        const equipped = result.rows[0]?.equipped_tools ?? [];
        if (!equipped.includes(toolKey)) {
            await client.query("ROLLBACK");
            return "not-equipped";
        }
        await client.query(
            "UPDATE player_scavenge_state SET equipped_tools = array_remove(equipped_tools, $2) WHERE player_id = $1",
            [playerId, toolKey],
        );
        await client.query("COMMIT");
        return "unequipped";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export function calculateScavengeWeights(
    candidates: readonly { key: string; item: Item }[],
    circulation: ReadonlyMap<string, number>,
    equippedTools: readonly Tool[],
    player: Player,
    bonuses: readonly ActiveItemBonus[],
): number[] {
    const rarityBonus = bonuses
        .filter(bonus => bonus.type === "scavengeRarity")
        .reduce((multiplier, bonus) => multiplier * bonus.multiplier, 1);
    return candidates.map(({ key, item }) => {
        let weight = getScavengeWeight(item, equippedTools);
        const quantity = circulation.get(key) ?? 0;
        weight *= Math.max(0.1, 1 / Math.sqrt(1 + quantity / 100));
        if ([Rarity.Rare, Rarity.Epic, Rarity.Legendary, Rarity.Mythic, Rarity.Eternal].includes(item.rarity)) {
            weight *= player.scavengeRarityMultiplier * rarityBonus;
        }
        return weight * player.scavengeWeightMultiplier;
    });
}

function chooseItem(candidates: readonly { key: string; item: Item }[], weights: readonly number[], random: () => number): Item {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error("No scavengable items are available for this tool.");
    let roll = random() * total;
    for (let index = 0; index < candidates.length; index++) {
        roll -= weights[index];
        if (roll < 0) return candidates[index].item;
    }
    return candidates[candidates.length - 1].item;
}

export function scavengeExperience(item: Item, quantity: number): number {
    const rarity = Object.values(Rarity).indexOf(item.rarity);
    return (15 + rarity * 10 + Math.min(1000, Math.floor(Math.sqrt(item.price) * 3))) * quantity;
}

export function scavengeOdds(weights: readonly number[]): (number | null)[] {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error("No scavengable items are available.");
    return weights.map(weight => weight > 0 ? total / weight : null);
}

export type ScavengeResult =
    | { status: "cooldown"; remainingMs: number }
    | { status: "full"; used: number; capacity: number }
    | { status: "found"; key: string; item: Item; quantity: number; odds: number; experienceAwarded: number;
        progression: ExperienceResult; equippedTools: string[]; nextScavengeAt: string };

export async function scavengeForPlayer(
    playerId: string,
    random: () => number = Math.random,
): Promise<ScavengeResult> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const playerRow = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!playerRow.rowCount) throw new Error("Player record not found");
        const player = await Player.findById(playerId, client);
        if (!player) throw new Error("Player record not found");
        await client.query(
            "INSERT INTO player_scavenge_state (player_id) VALUES ($1) ON CONFLICT DO NOTHING",
            [playerId],
        );
        const stateResult = await client.query<{ equipped_tools: string[]; next_scavenge_at: Date | null; backpack_key: string }>(
            "SELECT equipped_tools, next_scavenge_at, backpack_key FROM player_scavenge_state WHERE player_id = $1 FOR UPDATE",
            [playerId],
        );
        const state = stateResult.rows[0];
        const equippedToolKeys = state.equipped_tools.slice(0, player.toolSlots);
        if (equippedToolKeys.length !== state.equipped_tools.length) {
            await client.query(
                "UPDATE player_scavenge_state SET equipped_tools = $2 WHERE player_id = $1",
                [playerId, equippedToolKeys],
            );
        }
        const now = Date.now();
        const remainingMs = state.next_scavenge_at
            ? state.next_scavenge_at.getTime() - now
            : 0;
        if (remainingMs > 0) {
            await client.query("COMMIT");
            return { status: "cooldown", remainingMs };
        }
        const backpack = backpacks[state.backpack_key];
        if (!backpack) throw new Error(`Unknown equipped backpack ${state.backpack_key}`);
        const countResult = await client.query<{ used: string }>(
            "SELECT COALESCE(SUM(quantity), 0)::text AS used FROM player_items WHERE player_id = $1",
            [playerId],
        );
        const used = Number(countResult.rows[0].used);
        const available = backpack.capacity - used;
        if (available <= 0) {
            await client.query("COMMIT");
            return { status: "full", used, capacity: backpack.capacity };
        }

        const circulationResult = await client.query<{ item_key: string; quantity: string }>(
            "SELECT item_key, SUM(quantity)::text AS quantity FROM player_items GROUP BY item_key",
        );
        const circulation = new Map(circulationResult.rows.map(row => [row.item_key, Number(row.quantity)]));
        const equippedTools = equippedToolKeys.map(key => tools[key]).filter((tool): tool is Tool => !!tool);
        const activeResult = await client.query<{ bonus_type: string; multiplier: number }>(
            "SELECT bonus_type, multiplier FROM player_item_bonuses WHERE player_id = $1 AND expires_at > now()",
            [playerId],
        );
        const activeBonuses = activeResult.rows.map(({ bonus_type, multiplier }) => ({
            type: bonus_type, multiplier, expiresAt: "",
        }));
        const candidates = Object.entries(items).filter(([, candidate]) => candidate.canScavenge)
            .map(([key, candidate]) => ({ key, item: candidate }));
        const weights = calculateScavengeWeights(
            candidates,
            circulation,
            equippedTools.slice(0, player.toolSlots),
            player,
            activeBonuses,
        );
        const item = chooseItem(candidates, weights, random);
        const selectedIndex = candidates.findIndex(candidate => candidate.item === item);
        const key = candidates[selectedIndex].key;
        const odds = scavengeOdds(weights)[selectedIndex];
        if (odds === null) throw new Error("Selected item has zero scavenging probability");
        const extraFindChance = Math.min(0.75, player.scavengeExtraFindChance
            + activeBonuses.filter(bonus => bonus.type === "extraFindChance")
                .reduce((chance, bonus) => chance + bonus.multiplier, 0));
        const quantity = Math.min(available, 1 + (extraFindChance > 0 && random() < extraFindChance ? 1 : 0));
        await client.query(
            `INSERT INTO player_items (player_id, item_key, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (player_id, item_key)
             DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity`,
            [playerId, key, quantity],
        );
        const { experienceAwarded, progression } = player.addScavengeExperience(scavengeExperience(item, quantity));
        await player.save(client);
        const nextScavengeAt = new Date(now + getScavengeCooldownMs(player));
        await client.query(
            "UPDATE player_scavenge_state SET next_scavenge_at = $2 WHERE player_id = $1",
            [playerId, nextScavengeAt],
        );
        await client.query("COMMIT");
        try {
            await Player.invalidate(playerId);
        } catch (error) {
            console.error("Failed to invalidate player cache after scavenging:", error);
        }
        return { status: "found", key, item, quantity, odds, experienceAwarded, progression,
            equippedTools: equippedToolKeys, nextScavengeAt: nextScavengeAt.toISOString() };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function consumePlayerItem(
    playerId: string,
    itemKey: string,
): Promise<"used" | "unowned" | "not-consumable"> {
    const item = items[itemKey];
    if (!item?.consumableBonus) return "not-consumable";
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        const result = await client.query<{ quantity: number }>(
            "SELECT quantity FROM player_items WHERE player_id = $1 AND item_key = $2 FOR UPDATE",
            [playerId, itemKey],
        );
        const quantity = result.rows[0]?.quantity ?? 0;
        if (!quantity) {
            await client.query("ROLLBACK");
            return "unowned";
        }
        if (quantity === 1) {
            await client.query("DELETE FROM player_items WHERE player_id = $1 AND item_key = $2", [playerId, itemKey]);
        } else {
            await client.query(
                "UPDATE player_items SET quantity = quantity - 1 WHERE player_id = $1 AND item_key = $2",
                [playerId, itemKey],
            );
        }
        const bonus = item.consumableBonus;
        await client.query(
            `INSERT INTO player_item_bonuses (player_id, bonus_type, multiplier, expires_at)
             VALUES ($1, $2, $3, now() + ($4 * interval '1 minute'))
             ON CONFLICT (player_id, bonus_type) DO UPDATE SET
               multiplier = CASE WHEN player_item_bonuses.expires_at > now()
                   THEN player_item_bonuses.multiplier * EXCLUDED.multiplier
                   ELSE EXCLUDED.multiplier END,
               expires_at = GREATEST(player_item_bonuses.expires_at, now()) + ($4 * interval '1 minute')`,
            [playerId, bonus.type, bonus.multiplier, bonus.durationMinutes],
        );
        await client.query("COMMIT");
        return "used";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function craftPlayerItem(
    playerId: string,
    itemKey: string,
): Promise<{ status: "crafted"; item: Item } | { status: "not-craftable" } | { status: "missing"; item: Item; needed: number; owned: number }> {
    const item = items[itemKey];
    if (!(item instanceof CraftableItem)) return { status: "not-craftable" };
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        let currentBackpack: Item | undefined;
        if (item instanceof BackpackUpgrade) {
            await client.query(
                "INSERT INTO player_scavenge_state (player_id) VALUES ($1) ON CONFLICT DO NOTHING", [playerId],
            );
            const state = await client.query<{ backpack_key: string }>(
                "SELECT backpack_key FROM player_scavenge_state WHERE player_id = $1 FOR UPDATE", [playerId],
            );
            currentBackpack = backpacks[state.rows[0].backpack_key];
            if (!currentBackpack) throw new Error(`Unknown equipped backpack ${state.rows[0].backpack_key}`);
            if (currentBackpack !== item.previous) {
                await client.query("ROLLBACK");
                return { status: "missing", item: item.previous, needed: 1, owned: 0 };
            }
        }
        const ingredients = [...item.recipe].map(([ingredient, quantity]) => {
            const key = Object.entries(items).find(([, candidate]) => candidate === ingredient)?.[0];
            if (!key) throw new Error(`Crafting ingredient ${ingredient.name} is missing from the item catalog`);
            return {
            key,
            item: ingredient,
            quantity,
            owned: 0,
            };
        });
        for (const ingredient of ingredients) {
            if (ingredient.item === currentBackpack) {
                ingredient.owned = 1;
                continue;
            }
            const result = await client.query<{ quantity: number }>(
                "SELECT quantity FROM player_items WHERE player_id = $1 AND item_key = $2 FOR UPDATE",
                [playerId, ingredient.key],
            );
            const owned = result.rows[0]?.quantity ?? 0;
            if (owned < ingredient.quantity) {
                await client.query("ROLLBACK");
                return { status: "missing", item: ingredient.item, needed: ingredient.quantity, owned };
            }
            ingredient.owned = owned;
        }
        for (const ingredient of ingredients) {
            if (ingredient.item === currentBackpack) continue;
            if (ingredient.owned === ingredient.quantity) {
                await client.query("DELETE FROM player_items WHERE player_id = $1 AND item_key = $2", [playerId, ingredient.key]);
                if (ingredient.item instanceof Tool) {
                    await client.query(
                        "UPDATE player_scavenge_state SET equipped_tools = array_remove(equipped_tools, $2) WHERE player_id = $1",
                        [playerId, ingredient.key],
                    );
                }
            } else {
                await client.query(
                    "UPDATE player_items SET quantity = quantity - $3 WHERE player_id = $1 AND item_key = $2",
                    [playerId, ingredient.key, ingredient.quantity],
                );
            }
        }
        if (item instanceof BackpackUpgrade) {
            await client.query("UPDATE player_scavenge_state SET backpack_key = $2 WHERE player_id = $1", [playerId, itemKey]);
        } else {
            await client.query(
                `INSERT INTO player_items (player_id, item_key, quantity) VALUES ($1, $2, 1)
                 ON CONFLICT (player_id, item_key)
                 DO UPDATE SET quantity = player_items.quantity + 1`,
                [playerId, itemKey],
            );
        }
        await client.query("COMMIT");
        return { status: "crafted", item };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function sellPlayerItem(
    playerId: string, itemKey: string, amount: number,
): Promise<{ status: "sold"; item: Item; amount: number; proceeds: number; unequipped: boolean }
    | { status: "invalid" } | { status: "unowned"; owned: number }> {
    const item = Object.hasOwn(items, itemKey) ? items[itemKey] : undefined;
    if (!item || item.price <= 0 || !Number.isSafeInteger(amount) || amount < 1) return { status: "invalid" };
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const locked = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!locked.rowCount) throw new Error("Player record not found");
        const player = await Player.findById(playerId, client);
        if (!player) throw new Error("Player record not found");
        const result = await client.query<{ quantity: number }>(
            "SELECT quantity FROM player_items WHERE player_id = $1 AND item_key = $2 FOR UPDATE", [playerId, itemKey],
        );
        const owned = result.rows[0]?.quantity ?? 0;
        if (amount > owned) {
            await client.query("ROLLBACK");
            return { status: "unowned", owned };
        }
        let unequipped = false;
        if (amount === owned) {
            await client.query("DELETE FROM player_items WHERE player_id = $1 AND item_key = $2", [playerId, itemKey]);
            if (item instanceof Tool) {
                const updated = await client.query(
                    `UPDATE player_scavenge_state SET equipped_tools = array_remove(equipped_tools, $2)
                     WHERE player_id = $1 AND $2 = ANY(equipped_tools)`, [playerId, itemKey],
                );
                unequipped = (updated.rowCount ?? 0) > 0;
            }
        } else {
            await client.query("UPDATE player_items SET quantity = quantity - $3 WHERE player_id = $1 AND item_key = $2", [playerId, itemKey, amount]);
        }
        const proceeds = item.price * amount;
        if (!Number.isSafeInteger(proceeds) || !Number.isSafeInteger(player.balance + proceeds)) {
            throw new Error("Sale balance exceeds supported precision");
        }
        player.addBalance(proceeds);
        await player.save(client);
        await client.query("COMMIT");
        try {
            await Player.invalidate(playerId);
        } catch (error) {
            console.error("Failed to invalidate player cache after selling items:", error);
        }
        return { status: "sold", item, amount, proceeds, unequipped };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getPlayerItemProfile(playerId: string, toolSlots = 1) {
    const [inventory, state, bonuses] = await Promise.all([
        getPlayerItems(playerId),
        getPlayerScavengeState(playerId, toolSlots),
        getPlayerItemBonuses(playerId),
    ]);
    const backpack = backpacks[state.backpackKey];
    if (!backpack) throw new Error(`Unknown equipped backpack ${state.backpackKey}`);
    return {
        backpack: { key: state.backpackKey, name: backpack.name, capacity: backpack.capacity,
            used: inventory.reduce((sum, item) => sum + item.quantity, 0) },
        items: inventory.map(({ key, quantity }) => ({
            key,
            name: items[key]?.name ?? key,
            rarity: items[key]?.rarity ?? null,
            category: items[key]?.category ?? null,
            price: Object.hasOwn(items, key) ? items[key].price : null,
            quantity,
        })),
        equippedTools: state.equippedTools.map(key => ({ key, name: tools[key]?.name ?? key,
            description: tools[key] ? describeToolBonus(tools[key]) : `Details unavailable for tool ${key}.` })),
        bonuses,
    };
}
