import { Router } from "express";
import { debugTopics, getDebugLogs, isCasinoViewEnabled, isDebugEnabled, setCasinoViewEnabled, setDebugSetting } from "../debugSettings.js";
import { refreshBotShop } from "../botShop.js";
import { getPool } from "../database.js";
import { emptyProfile, houseLearningTactics, type PlayerProfile } from "../houseLearnsGame.js";

const router = Router();

router.get("/house-learns/players", async (request, response) => {
    const search = request.query.search;
    const after = request.query.after;
    if ((search !== undefined && (typeof search !== "string" || search.length > 100)) ||
        (after !== undefined && (typeof after !== "string" || after.length > 100))) {
        response.status(400).json({ error: "Invalid search or cursor." });
        return;
    }
    try {
        const result = await getPool().query<{ id: string; name: string; learned: boolean }>(
            `SELECT p.id, COALESCE(NULLIF(p.data->>'name',''), p.id) AS name,
                    (h.id IS NOT NULL) AS learned
             FROM players p LEFT JOIN house_learns_profiles h ON h.id='player:' || p.id
             WHERE p.id > $2 AND (strpos(lower(p.id), lower($1)) > 0
                OR strpos(lower(COALESCE(p.data->>'name','')), lower($1)) > 0)
             ORDER BY p.id LIMIT 21`,
            [search?.trim() ?? "", after ?? ""],
        );
        const players = result.rows.slice(0, 20);
        response.json({ players, next: result.rows.length > 20 ? players[players.length - 1].id : null });
    } catch (error) {
        console.error("Failed to search House Learns players:", error);
        response.status(500).json({ error: "Could not search players." });
    }
});

router.get("/house-learns/players/:id", async (request, response) => {
    try {
        const result = await getPool().query<{ id: string; name: string; player: PlayerProfile | null; global: PlayerProfile | null }>(
            `SELECT p.id, COALESCE(NULLIF(p.data->>'name',''), p.id) AS name,
                    personal.data AS player, shared.data AS global
             FROM players p
             LEFT JOIN house_learns_profiles personal ON personal.id='player:' || p.id
             LEFT JOIN house_learns_profiles shared ON shared.id='global'
             WHERE p.id=$1`,
            [request.params.id],
        );
        const row = result.rows[0];
        if (!row) {
            response.status(404).json({ error: "Player not found." });
            return;
        }
        const player = row.player ?? emptyProfile();
        const global = row.global ?? emptyProfile();
        response.json({ id: row.id, name: row.name, player, global, tactics: houseLearningTactics(player, global) });
    } catch (error) {
        console.error("Failed to load House Learns profile:", error);
        response.status(500).json({ error: "Could not load the learning profile." });
    }
});

router.post("/bot-shop/refresh", async (request, response) => {
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest") {
        response.status(400).json({ error: "JSON and X-Requested-With are required." });
        return;
    }
    try {
        await refreshBotShop();
        response.json({ ok: true });
    } catch (error) {
        console.error("Failed to refresh bot shop:", error);
        response.status(500).json({ error: "Could not refresh the bot shop." });
    }
});

router.get("/", async (_request, response) => {
    try {
        const [enabled, logs, casinoView] = await Promise.all([
            Promise.all(debugTopics.map(topic => isDebugEnabled(topic))),
            getDebugLogs(),
            isCasinoViewEnabled(),
        ]);
        response.json({ settings: Object.fromEntries(debugTopics.map((topic, index) => [topic, enabled[index]])), logs, casinoView });
    } catch (error) {
        console.error("Failed to load developer diagnostics:", error);
        response.status(500).json({ error: "Could not load diagnostics." });
    }
});

router.put("/casino-view", async (request, response) => {
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest" ||
        typeof request.body?.enabled !== "boolean") {
        response.status(400).json({ error: "Invalid casino view setting." });
        return;
    }
    try {
        await setCasinoViewEnabled(request.body.enabled);
        response.json({ enabled: request.body.enabled });
    } catch (error) {
        console.error("Failed to update casino view:", error);
        response.status(500).json({ error: "Could not update casino view." });
    }
});

router.put("/settings/:topic", async (request, response) => {
    const topic = debugTopics.find(item => item === request.params.topic);
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest" ||
        !topic || typeof request.body?.enabled !== "boolean") {
        response.status(400).json({ error: "Invalid debug setting." });
        return;
    }
    try {
        await setDebugSetting(topic, request.body.enabled);
        response.json({ topic, enabled: request.body.enabled });
    } catch (error) {
        console.error("Failed to update developer diagnostics:", error);
        response.status(500).json({ error: "Could not update diagnostics." });
    }
});

export default router;
