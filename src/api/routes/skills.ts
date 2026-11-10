import { Router } from "express";
import { loadSession } from "../../auth.js";
import Player from "../../classes/Player.js";
import { getPool } from "../../database.js";
import { getSkill, skills } from "../../resources/skills.js";

const router = Router();
const entries = Object.entries(skills);
const keysBySkill = new Map(entries.map(([key, skill]) => [skill, key]));
const catalog = entries.map(([key, skill]) => {
    const prerequisites = skill.prerequisites.map(prerequisite => {
        const prerequisiteKey = keysBySkill.get(prerequisite);
        if (prerequisiteKey === undefined) {
            throw new Error(`Unknown prerequisite for skill ${key}`);
        }
        return prerequisiteKey;
    });
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
    const skill = getSkill(request.params.key);
    if (!skill) {
        response.status(404).json({ error: "Skill not found" });
        return;
    }

    const prerequisites = skill.prerequisites.map(prerequisite => {
        const key = keysBySkill.get(prerequisite);
        if (key === undefined) throw new Error(`Unknown prerequisite for skill ${request.params.key}`);
        return key;
    });
    const userId: string = response.locals.userId;
    const result = await getPool().query<{ data: { skills: string[]; skillPoints: number } }>(
        `UPDATE players
         SET data = jsonb_set(
             jsonb_set(data, '{skillPoints}', to_jsonb(COALESCE((data->>'skillPoints')::numeric, 0) - $3::numeric)),
             '{skills}', COALESCE(data->'skills', '[]'::jsonb) || jsonb_build_array($2::text)
         )
         WHERE id = $1
           AND NOT (COALESCE(data->'skills', '[]'::jsonb) ? $2::text)
           AND COALESCE(data->'skills', '[]'::jsonb) ?& $4::text[]
           AND COALESCE((data->>'skillPoints')::numeric, 0) >= $3::numeric
         RETURNING data`,
        [userId, request.params.key, skill.cost, prerequisites],
    );
    if (!result.rows[0]) {
        const player = await Player.findById(userId);
        if (!player) {
            response.status(404).json({ error: "Player not found" });
        } else if (player.skills.includes(request.params.key)) {
            response.status(409).json({ error: "Skill already unlocked" });
        } else if (prerequisites.some(prerequisite => !player.skills.includes(prerequisite))) {
            response.status(409).json({ error: "Unlock all prerequisites first" });
        } else {
            response.status(409).json({ error: "Not enough skill points" });
        }
        return;
    }
    await Player.invalidate(userId);
    response.json({
        unlocked: result.rows[0].data.skills,
        skillPoints: result.rows[0].data.skillPoints,
    });
});

export default router;
