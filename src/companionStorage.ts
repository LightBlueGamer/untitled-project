import { getPool } from "./database.js";
import { getCompanion } from "./resources/companions.js";
import Player, { type Data } from "./classes/Player.js";

export interface OwnedCompanion {
    readonly key: string;
    readonly quantity: number;
}

export async function initializeCompanionStorage(): Promise<void> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(1097823942)");
        await client.query(`
            CREATE TABLE IF NOT EXISTS player_companions (
                player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                companion_key TEXT NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                PRIMARY KEY (player_id, companion_key)
            );
            CREATE TABLE IF NOT EXISTS companion_events (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                player_id TEXT NOT NULL,
                companion_key TEXT NOT NULL,
                quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS companion_events_key_idx ON companion_events (companion_key);
            CREATE TABLE IF NOT EXISTS companion_encounters (
                id UUID PRIMARY KEY,
                channel_id TEXT NOT NULL,
                message_id TEXT,
                companion_key TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                caught_by TEXT,
                expired BOOLEAN NOT NULL DEFAULT false
            );
            CREATE TABLE IF NOT EXISTS companion_channel_state (
                channel_id TEXT PRIMARY KEY,
                chance INTEGER NOT NULL CHECK (chance BETWEEN 1 AND 1000),
                last_user_id TEXT NOT NULL
            );
            CREATE OR REPLACE FUNCTION record_companion_change() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'UPDATE' AND (OLD.player_id <> NEW.player_id OR OLD.companion_key <> NEW.companion_key) THEN
                    RAISE EXCEPTION 'Cannot change a companion inventory key';
                END IF;
                IF TG_OP = 'INSERT' THEN
                    INSERT INTO companion_events (player_id, companion_key, quantity_change)
                    VALUES (NEW.player_id, NEW.companion_key, NEW.quantity);
                ELSIF TG_OP = 'DELETE' THEN
                    INSERT INTO companion_events (player_id, companion_key, quantity_change)
                    VALUES (OLD.player_id, OLD.companion_key, -OLD.quantity);
                ELSIF OLD.quantity <> NEW.quantity THEN
                    INSERT INTO companion_events (player_id, companion_key, quantity_change)
                    VALUES (NEW.player_id, NEW.companion_key, NEW.quantity - OLD.quantity);
                END IF;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;
            DROP TRIGGER IF EXISTS companion_inventory_events ON player_companions;
            CREATE TRIGGER companion_inventory_events
                AFTER INSERT OR UPDATE OR DELETE ON player_companions
                FOR EACH ROW EXECUTE FUNCTION record_companion_change();
        `);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export interface CompanionChannelState {
    chance: number;
    lastUserId: string;
}

export async function getCompanionChannelState(channelId: string): Promise<CompanionChannelState | null> {
    const result = await getPool().query<{ chance: number; last_user_id: string }>(
        "SELECT chance, last_user_id FROM companion_channel_state WHERE channel_id = $1",
        [channelId],
    );
    const state = result.rows[0];
    return state ? { chance: state.chance, lastUserId: state.last_user_id } : null;
}

export async function saveCompanionChannelState(channelId: string, state: CompanionChannelState): Promise<void> {
    await getPool().query(
        `INSERT INTO companion_channel_state (channel_id, chance, last_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id) DO UPDATE
         SET chance = EXCLUDED.chance, last_user_id = EXCLUDED.last_user_id`,
        [channelId, state.chance, state.lastUserId],
    );
}

export interface CompanionEncounter {
    id: string;
    channel_id: string;
    message_id: string | null;
    companion_key: string;
    expires_at: Date;
}

export async function createCompanionEncounter(id: string, channelId: string, key: string): Promise<CompanionEncounter> {
    assertCompanion(key);
    const result = await getPool().query<CompanionEncounter>(
        `INSERT INTO companion_encounters (id, channel_id, companion_key, expires_at)
         VALUES ($1, $2, $3, clock_timestamp() + interval '30 seconds')
         RETURNING id, channel_id, message_id, companion_key, expires_at`,
        [id, channelId, key],
    );
    return result.rows[0];
}

export async function setEncounterMessage(id: string, messageId: string): Promise<CompanionEncounter> {
    const result = await getPool().query<CompanionEncounter>(
        `UPDATE companion_encounters SET message_id = $2, expires_at = clock_timestamp() + interval '30 seconds'
         WHERE id = $1 RETURNING id, channel_id, message_id, companion_key, expires_at`,
        [id, messageId],
    );
    if (!result.rows[0]) throw new Error("Companion encounter not found");
    return result.rows[0];
}

export async function cancelCompanionEncounter(id: string): Promise<void> {
    await getPool().query("DELETE FROM companion_encounters WHERE id = $1 AND caught_by IS NULL", [id]);
}

export async function getOpenCompanionEncounters(): Promise<CompanionEncounter[]> {
    const result = await getPool().query<CompanionEncounter>(
        `SELECT id, channel_id, message_id, companion_key, expires_at
         FROM companion_encounters WHERE caught_by IS NULL AND NOT expired AND message_id IS NOT NULL`,
    );
    return result.rows;
}

export async function expireCompanionEncounter(id: string): Promise<boolean> {
    const result = await getPool().query(
        `UPDATE companion_encounters SET expired = true
         WHERE id = $1 AND caught_by IS NULL AND NOT expired AND expires_at <= clock_timestamp()`,
        [id],
    );
    return result.rowCount === 1;
}

export async function catchCompanionEncounter(id: string, channelId: string, messageId: string, playerId: string, playerName: string): Promise<string | null> {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const encounter = await client.query<{ companion_key: string }>(
            `UPDATE companion_encounters SET caught_by = $4
             WHERE id = $1 AND channel_id = $2 AND message_id = $3
               AND caught_by IS NULL AND NOT expired AND expires_at > clock_timestamp()
             RETURNING companion_key`,
            [id, channelId, messageId, playerId],
        );
        const key = encounter.rows[0]?.companion_key;
        if (key) {
            await client.query(
                `INSERT INTO players (id, data) VALUES ($1, jsonb_build_object('name', $2::text))
                 ON CONFLICT (id) DO NOTHING`,
                [playerId, playerName],
            );
            await client.query(
                `INSERT INTO player_companions (player_id, companion_key, quantity)
                 VALUES ($1, $2, 1)
                 ON CONFLICT (player_id, companion_key)
                 DO UPDATE SET quantity = player_companions.quantity + 1`,
                [playerId, key],
            );
        }
        await client.query("COMMIT");
        return key ?? null;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function assertCompanion(key: string): void {
    if (!getCompanion(key)) throw new Error(`Unknown companion: ${key}`);
}

export async function obtainCompanion(playerId: string, key: string): Promise<number> {
    assertCompanion(key);
    const result = await getPool().query<{ quantity: number }>(
        `INSERT INTO player_companions (player_id, companion_key, quantity)
         VALUES ($1, $2, 1)
         ON CONFLICT (player_id, companion_key)
         DO UPDATE SET quantity = player_companions.quantity + 1
         RETURNING quantity`,
        [playerId, key],
    );
    return result.rows[0].quantity;
}

export async function loseCompanion(playerId: string, key: string): Promise<number> {
    assertCompanion(key);
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const playerRow = await client.query<{ data: Partial<Data> }>("SELECT data FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!playerRow.rows[0]) throw new Error("Player does not exist");
        const existing = await client.query<{ quantity: number }>(
            "SELECT quantity FROM player_companions WHERE player_id = $1 AND companion_key = $2 FOR UPDATE",
            [playerId, key],
        );
        if (!existing.rows[0]) throw new Error("Player does not own this companion");
        const quantity = existing.rows[0].quantity - 1;
        if (quantity === 0) {
            await client.query("DELETE FROM player_companions WHERE player_id = $1 AND companion_key = $2", [playerId, key]);
            const player = new Player(playerId, playerId, playerRow.rows[0].data);
            await writeEquipment(client, playerId, player.equippedCompanions.filter(item => item !== key));
        } else {
            await client.query(
                "UPDATE player_companions SET quantity = $3 WHERE player_id = $1 AND companion_key = $2",
                [playerId, key, quantity],
            );
        }
        await client.query("COMMIT");
        return quantity;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

type EquipmentResult = "equipped" | "unowned" | "already-equipped" | "full" | "unequipped" | "not-equipped";

async function writeEquipment(client: import("pg").PoolClient, playerId: string, equipment: string[]): Promise<void> {
    await client.query(
        `UPDATE players SET data = jsonb_set(jsonb_set(data, '{equippedCompanions}', $2::jsonb),
             '{equippedCompanion}', COALESCE($2::jsonb->0, 'null'::jsonb)) WHERE id = $1`,
        [playerId, JSON.stringify(equipment)],
    );
}

export async function equipCompanion(playerId: string, key: string): Promise<EquipmentResult> {
    assertCompanion(key);
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const row = await client.query<{ data: Partial<Data> }>("SELECT data FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!row.rows[0]) throw new Error("Player does not exist");
        const player = new Player(playerId, playerId, row.rows[0].data);
        const owned = await client.query(
            "SELECT 1 FROM player_companions WHERE player_id = $1 AND companion_key = $2",
            [playerId, key],
        );
        let result: EquipmentResult;
        if (!owned.rows[0]) result = "unowned";
        else if (player.equippedCompanions.includes(key)) result = "already-equipped";
        else if (player.equippedCompanions.length >= player.companionSlots) result = "full";
        else {
            await writeEquipment(client, playerId, [...player.equippedCompanions, key]);
            result = "equipped";
        }
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function unequipCompanion(playerId: string, key: string): Promise<EquipmentResult> {
    assertCompanion(key);
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const row = await client.query<{ data: Partial<Data> }>("SELECT data FROM players WHERE id = $1 FOR UPDATE", [playerId]);
        if (!row.rows[0]) throw new Error("Player does not exist");
        const player = new Player(playerId, playerId, row.rows[0].data);
        const equipment = player.equippedCompanions;
        if (!equipment.includes(key)) {
            await client.query("COMMIT");
            return "not-equipped";
        }
        await writeEquipment(client, playerId, equipment.filter(item => item !== key));
        await client.query("COMMIT");
        return "unequipped";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getPlayerCompanions(playerId: string): Promise<OwnedCompanion[]> {
    const result = await getPool().query<OwnedCompanion>(
        `SELECT companion_key AS key, quantity FROM player_companions
         WHERE player_id = $1 ORDER BY companion_key`,
        [playerId],
    );
    return result.rows;
}

export async function getCompanionCirculation(): Promise<{ key: string; quantity: string }[]> {
    const result = await getPool().query<{ key: string; quantity: string }>(
        `SELECT key, sum(quantity)::text AS quantity FROM (
            SELECT companion_key AS key, quantity_change::bigint AS quantity FROM companion_events
            UNION ALL
            SELECT asset->>'key', (asset->>'quantity')::bigint FROM auctions
                WHERE status = 'active' AND asset->>'kind' = 'companion'
            UNION ALL
            SELECT asset->>'key', (asset->>'quantity')::bigint FROM auction_claims
                WHERE claimed_at IS NULL AND asset->>'kind' = 'companion'
         ) circulation GROUP BY key ORDER BY key`,
    );
    return result.rows;
}
