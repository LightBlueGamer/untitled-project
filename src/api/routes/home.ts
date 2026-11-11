import { Router } from "express";
import { getCache, getPool } from "../../database.js";
import { websiteDiscordStatsKey } from "../../websiteStats.js";

const router = Router();
const statsMaxAgeMs = 45 * 60 * 1000;

interface HomeStatsRow {
    total_balance: string;
    total_experience: string;
    top_players: {
        id: string;
        name: string;
        prestige: number;
        level: number;
        balance: string;
    }[];
}

interface DiscordStats {
    guildCount: number;
    uniqueUsers: number;
    updatedAt: string;
}

router.get("/", async (_request, response) => {
    try {
        const [result, cachedDiscordStats] = await Promise.all([
            getPool().query<HomeStatsRow>(`
                WITH totals AS (
                    SELECT
                        COALESCE(SUM(COALESCE((data->>'balance')::numeric, 0)), 0)::text AS total_balance,
                        COALESCE(SUM(GREATEST(
                            COALESCE((p.data->>'totalExperience')::numeric, 0),
                            COALESCE(p.data->>'experience', '0')::numeric +
                                COALESCE((
                                    SELECT SUM(FLOOR(25 + 15 * levels.level
                                        + 50 * POWER(1.15, levels.level - 1)))
                                    FROM generate_series(0, GREATEST(0, COALESCE((p.data->>'prestige')::int, 0))) AS cycles(cycle)
                                    CROSS JOIN LATERAL generate_series(1,
                                        GREATEST(0, CASE
                                            WHEN cycles.cycle = COALESCE((p.data->>'prestige')::int, 0)
                                                THEN COALESCE((p.data->>'level')::int, 1) - 1
                                            ELSE (10 * POWER(2, cycles.cycle) - 1)::int
                                        END)
                                    ) AS levels(level)
                                ), 0)
                        )), 0)::text AS total_experience
                    FROM players p
                ),
                ranked_players AS (
                    SELECT
                        id,
                        COALESCE(data->>'name', id) AS name,
                        COALESCE((data->>'prestige')::numeric, 0) AS prestige,
                        COALESCE((data->>'level')::numeric, 1) AS level,
                        COALESCE((data->>'experience')::numeric, 0) AS experience,
                        COALESCE((data->>'balance')::numeric, 0) AS balance
                    FROM players
                    ORDER BY
                        COALESCE((data->>'prestige')::numeric, 0) DESC,
                        COALESCE((data->>'level')::numeric, 1) DESC,
                        COALESCE((data->>'experience')::numeric, 0) DESC,
                        COALESCE((data->>'balance')::numeric, 0) DESC,
                        id ASC
                    LIMIT 3
                ),
                top_players AS (
                    SELECT COALESCE(
                        jsonb_agg(jsonb_build_object(
                            'id', id,
                            'name', name,
                            'prestige', prestige,
                            'level', level,
                            'balance', balance::text
                        ) ORDER BY prestige DESC, level DESC, experience DESC, balance DESC, id ASC),
                        '[]'::jsonb
                    ) AS players
                    FROM ranked_players
                )
                SELECT totals.total_balance, totals.total_experience, top_players.players AS top_players
                FROM totals CROSS JOIN top_players
            `),
            getCache().get(websiteDiscordStatsKey),
        ]);
        const totals = result.rows[0];
        if (!totals) throw new Error("Home statistics query returned no result");

        let discordStats: DiscordStats | null = null;
        if (cachedDiscordStats) {
            discordStats = JSON.parse(cachedDiscordStats) as DiscordStats;
            const updatedAt = Date.parse(discordStats.updatedAt);
            if (!Number.isFinite(updatedAt)) throw new Error("Cached Discord stats have an invalid update time");
            if (Date.now() - updatedAt > statsMaxAgeMs) discordStats = null;
        }

        const clientId = process.env.DISCORD_CLIENT_ID;
        const inviteUrl = clientId
            ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=84992`
            : null;
        const userInstallUrl = clientId
            ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=applications.commands&integration_type=1`
            : null;

        response.setHeader("Cache-Control", "no-store");
        response.json({
            guildCount: discordStats?.guildCount ?? null,
            uniqueUsers: discordStats?.uniqueUsers ?? null,
            discordStatsUpdatedAt: discordStats?.updatedAt ?? null,
            totalBalance: totals.total_balance,
            totalExperience: totals.total_experience,
            topPlayers: totals.top_players,
            inviteUrl,
            userInstallUrl,
        });
    } catch (error) {
        console.error("Failed to fetch homepage statistics:", error);
        response.status(500).json({ error: "Failed to fetch homepage statistics" });
    }
});

export default router;
