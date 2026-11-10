import { Router } from "express";
import { loadSession } from "../../auth.js";
import Player from "../../classes/Player.js";
import { getCompanionCirculation } from "../../companionStorage.js";
import { companionSelectionWeights, companions, getCompanion } from "../../resources/companions.js";

const router = Router();

router.get("/circulation", async (_request, response) => {
    const counts = await getCompanionCirculation();
    const byKey = new Map(counts.map(({ key, quantity }) => [key, quantity]));
    const catalog = Object.entries(companions).map(([key, companion]) => ({
        key, name: companion.name, rarity: companion.rarity, quantity: byKey.get(key) ?? "0",
    }));
    const retired = counts.filter(({ key }) => !Object.hasOwn(companions, key))
        .map(({ key, quantity }) => ({ key, name: null, rarity: null, quantity }));
    response.setHeader("Cache-Control", "no-store");
    response.json({ companions: [...catalog, ...retired] });
});

router.get("/mine", async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) {
        response.status(401).json({ error: "Login required" });
        return;
    }
    const player = await Player.findById(user.id);
    if (!player) {
        response.status(404).json({ error: "Player not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json({ companions: player.companions });
});

router.get("/player/:id", async (request, response) => {
    const player = await Player.findById(request.params.id);
    if (!player) {
        response.status(404).json({ error: "Player not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json({
        companions: player.companions.map(({ key, quantity }) => {
            const companion = getCompanion(key);
            return {
                key, quantity, name: companion?.name ?? null, rarity: companion?.rarity ?? null,
                equipped: player.equippedCompanions.includes(key),
            };
        }),
    });
});

router.get("/wiki/:key", async (request, response) => {
    const companion = getCompanion(request.params.key);
    if (!companion) {
        response.status(404).json({ error: "Companion not found" });
        return;
    }
    const counts = await getCompanionCirculation();
    const weights = companionSelectionWeights(counts);
    const weight = weights.find(item => item.key === request.params.key);
    if (!weight) throw new Error("Missing companion selection weight");
    const total = weights.reduce((sum, item) => sum + item.weight, 0);
    response.setHeader("Cache-Control", "no-store");
    response.json({
        key: request.params.key, name: companion.name, rarity: companion.rarity,
        description: companion.description, stats: companion.stats,
        quantity: counts.find(item => item.key === request.params.key)?.quantity ?? "0",
        weight: weight.weight, percentage: weight.weight / total * 100,
    });
});

export default router;
