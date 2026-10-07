import { Pool } from "pg";
import { createClient, RedisClientType } from "redis";
import "dotenv/config";
import type { Data } from "./classes/Player.js";

const databaseUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;

if (!databaseUrl) {
    throw new Error("POSTGRES_URL is not configured");
}

if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
}

export const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
        process.env.NODE_ENV === "production"
            ? { rejectUnauthorized: false }
            : false,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
});

export async function initDatabase(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb
        )
    `);
}

export const redisClient: RedisClientType = createClient({
    url: redisUrl,
});

let redisInitialized = false;

pool.on("error", (error) => {
    console.error("PostgreSQL pool error:", error);
});

pool.on("connect", () => {
    console.log("✅ PostgreSQL connected");
});

redisClient.on("error", (error) => {
    console.error("Redis error:", error);
});

export async function initRedis(): Promise<RedisClientType> {
    if (!redisClient.isOpen) {
        await redisClient.connect();
        redisInitialized = true;
        console.log("✅ Redis connected");
    }

    return redisClient;
}

export async function testConnections(): Promise<void> {
    try {
        const dbClient = await pool.connect();

        try {
            await dbClient.query("SELECT 1");
        } finally {
            dbClient.release();
        }

        if (!redisClient.isOpen) {
            await initRedis();
        }

        await redisClient.ping();

        console.log("✅ Database connections healthy");
    } catch (error) {
        console.error("❌ Database connection failed:", error);
        process.exit(1);
    }
}

export async function disconnect(): Promise<void> {
    if (redisClient.isOpen) {
        await redisClient.quit();
        redisInitialized = false;
    }

    await pool.end();
}

export function getCache(): RedisClientType {
    if (!redisInitialized || !redisClient.isOpen) {
        throw new Error("Redis is not initialized");
    }

    return redisClient;
}

export function getPool(): Pool {
    return pool;
}

export async function getTopPlayers(
    category: "level" | "wealth",
    page = 1
): Promise<{
    players: { id: string; data: Partial<Data> }[];
    totalCount: number;
}> {
    const playersPerPage = 10;
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * playersPerPage;

    const db = getPool();
    const dbClient = await db.connect();

    try {
        const orderByClause =
            category === "level"
                ? `
                    (data->>'prestige')::numeric DESC NULLS LAST,
                    (data->>'level')::numeric DESC NULLS LAST,
                    (data->>'experience')::numeric DESC NULLS LAST
                  `
                : `
                    (data->>'balance')::numeric DESC NULLS LAST
                  `;

        const result = await dbClient.query(
            `
            SELECT id, data
            FROM players
            ORDER BY ${orderByClause}
            LIMIT $1 OFFSET $2
            `,
            [playersPerPage, offset]
        );

        const totalResult = await dbClient.query<{ total: string }>(
            "SELECT COUNT(*) AS total FROM players"
        );

        return {
            players: result.rows.map((row) => ({
                id: row.id,
                data: row.data as Partial<Data>,
            })),
            totalCount: Number(totalResult.rows[0].total),
        };
    } finally {
        dbClient.release();
    }
}