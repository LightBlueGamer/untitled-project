import { getPool } from "./database.js";

export type DebugTopic = "chance" | "rewards" | "gambling";

export async function setDebugSetting(topic: DebugTopic, scope: string, enabled: boolean): Promise<void> {
    if (enabled) {
        await getPool().query(
            "INSERT INTO debug_settings (topic, scope) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [topic, scope],
        );
    } else {
        await getPool().query("DELETE FROM debug_settings WHERE topic = $1 AND scope = $2", [topic, scope]);
    }
}

export async function isDebugEnabled(topic: DebugTopic, scope: string): Promise<boolean> {
    const result = await getPool().query(
        "SELECT 1 FROM debug_settings WHERE topic = $1 AND scope = $2",
        [topic, scope],
    );
    return (result.rowCount ?? 0) > 0;
}

export function debugLog(topic: DebugTopic, scope: string, message: string): void {
    void isDebugEnabled(topic, scope).then(enabled => {
        if (enabled) console.log(`[debug:${topic}] ${message}`);
    }).catch(error => console.error(`Failed to check ${topic} debug setting:`, error));
}
