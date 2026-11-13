import { Router } from "express";
import { debugTopics, getDebugLogs, isDebugEnabled, setDebugSetting } from "../debugSettings.js";
import { refreshBotShop } from "../botShop.js";

const router = Router();

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
        const [enabled, logs] = await Promise.all([
            Promise.all(debugTopics.map(topic => isDebugEnabled(topic))),
            getDebugLogs(),
        ]);
        response.json({ settings: Object.fromEntries(debugTopics.map((topic, index) => [topic, enabled[index]])), logs });
    } catch (error) {
        console.error("Failed to load developer diagnostics:", error);
        response.status(500).json({ error: "Could not load diagnostics." });
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
