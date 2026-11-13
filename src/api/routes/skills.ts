import { Router } from "express";
import { loadSession } from "../../auth.js";
import Player from "../../classes/Player.js";
import { skills, skillPrerequisiteKeys } from "../../resources/skills.js";
import { unlockSkill } from "../../skillStorage.js";

const router = Router();
const entries = Object.entries(skills);
const catalog = entries.map(([key, skill]) => {
    const prerequisites = skillPrerequisiteKeys(key);
    return {
        key,
        name: skill.name,
        description: skill.description,
        cost: skill.cost,
        effect: skill.effect,
        prerequisite: prerequisites[0] ?? null,
        prerequisites,
    };
});

router.get("/player/:id", async (request, response) => {
    const player = await Player.findById(request.params.id);
    if (!player) {
        response.status(404).json({ error: "Player not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json({ name: player.name, skills: catalog, unlocked: player.skills, skillPoints: player.skillPoints });
});

router.use(async (request, response, next) => {
    try {
        const user = await loadSession(request.headers.cookie);
        if (!user) {
            response.status(401).json({ error: "Login required" });
            return;
        }
        response.locals.userId = user.id;
        response.setHeader("Cache-Control", "no-store");
        next();
    } catch (error) {
        next(error);
    }
});

router.get("/", async (_request, response) => {
    const player = await Player.findById(response.locals.userId);
    if (!player) {
        response.status(404).json({ error: "Player not found. Create a player by participating in Discord first." });
        return;
    }
    response.json({ skills: catalog, unlocked: player.skills, skillPoints: player.skillPoints });
});

router.post("/:key", async (request, response) => {
    const result = await unlockSkill(response.locals.userId, request.params.key);
    if (result.status === "unlocked") {
        response.json({ unlocked: result.skills, skillPoints: result.skillPoints });
        return;
    }
    const messages = {
        invalid: "Skill not found", "not-found": "Player not found",
        "already-unlocked": "Skill already unlocked", prerequisites: "Unlock all prerequisites first",
        "insufficient-points": "Not enough skill points", stale: "Player progression changed",
    };
    response.status(result.status === "invalid" || result.status === "not-found" ? 404 : 409).json({ error: messages[result.status] });
});

export default router;
