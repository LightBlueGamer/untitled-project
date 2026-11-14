import { getCache, getPool } from "./database.js";

export type DebugTopic = "chance" | "rewards" | "gambling" | "lootboxes";
export const debugTopics: readonly DebugTopic[] = ["chance", "rewards", "gambling", "lootboxes"];
const logKey = "developer:debug-logs";
const maxLogs = 500;

export interface DebugContext {
    userId?: string;
    username?: string;
    guild?: string;
    channel?: string;
}

export async function setDebugSetting(topic: DebugTopic, enabled: boolean): Promise<void> {
    if (enabled) {
        await getPool().query(
            "INSERT INTO debug_settings (topic, scope) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [topic, "global"],
        );
    } else {
        await getPool().query("DELETE FROM debug_settings WHERE topic = $1 AND scope = $2", [topic, "global"]);
    }
}

export async function isDebugEnabled(topic: DebugTopic): Promise<boolean> {
    const result = await getPool().query(
        "SELECT 1 FROM debug_settings WHERE topic = $1 AND scope = $2",
        [topic, "global"],
    );
    return (result.rowCount ?? 0) > 0;
}

export async function isCasinoViewEnabled(): Promise<boolean> {
    const result = await getPool().query(
        "SELECT 1 FROM debug_settings WHERE topic = $1 AND scope = $2",
        ["casino_view_disabled", "global"],
    );
    return (result.rowCount ?? 0) === 0;
}

export async function setCasinoViewEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
        await getPool().query("DELETE FROM debug_settings WHERE topic = $1 AND scope = $2", ["casino_view_disabled", "global"]);
    } else {
        await getPool().query(
            "INSERT INTO debug_settings (topic, scope) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            ["casino_view_disabled", "global"],
        );
    }
}

export async function getDebugLogs(): Promise<unknown[]> {
    const entries = await getCache().lRange(logKey, 0, maxLogs - 1);
    return entries.map(entry => JSON.parse(entry) as unknown);
}

export function debugLog(topic: DebugTopic, _scope: string, message: string, context: DebugContext = {}): void {
    void (async () => {
        if (!await isDebugEnabled(topic)) return;
        const entry = { timestamp: new Date().toISOString(), topic, message, ...context };
        console.log(`[debug:${topic}] ${JSON.stringify(entry)}`);
        await getCache().multi().lPush(logKey, JSON.stringify(entry)).lTrim(logKey, 0, maxLogs - 1).exec();
    })().catch(error => console.error(`Failed to record ${topic} debug log:`, error));
}
