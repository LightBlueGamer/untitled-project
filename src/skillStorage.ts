import Player from "./classes/Player.js";
import { getPool } from "./database.js";
import { getSkill, skillPrerequisiteKeys } from "./resources/skills.js";

export type SkillUnlockResult =
    | { status: "unlocked"; skills: string[]; skillPoints: number }
    | { status: "invalid" | "not-found" | "already-unlocked" | "prerequisites" | "insufficient-points" | "stale" };

export async function unlockSkill(userId: string, key: string, expectedPrestige?: number): Promise<SkillUnlockResult> {
    const skill = getSkill(key);
    if (!skill) return { status: "invalid" };
    const prerequisites = skillPrerequisiteKeys(key);
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
           AND ($5::numeric IS NULL OR COALESCE((data->>'prestige')::numeric, 0) = $5::numeric)
         RETURNING data`,
        [userId, key, skill.cost, prerequisites, expectedPrestige ?? null],
    );
    if (!result.rows[0]) {
        const player = await Player.findById(userId);
        if (!player) return { status: "not-found" };
        if (expectedPrestige !== undefined && player.prestigeLevel !== expectedPrestige) return { status: "stale" };
        if (player.skills.includes(key)) return { status: "already-unlocked" };
        if (prerequisites.some(prerequisite => !player.skills.includes(prerequisite))) return { status: "prerequisites" };
        return { status: "insufficient-points" };
    }
    await Player.invalidate(userId);
    return { status: "unlocked", skills: result.rows[0].data.skills, skillPoints: result.rows[0].data.skillPoints };
}
