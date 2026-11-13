import { getCache } from "./database.js";

export interface DiscordProfile {
    username: string;
    avatarUrl: string;
}

export async function getDiscordProfile(id: string): Promise<DiscordProfile | null> {
    if (!/^\d{15,20}$/.test(id)) return null;
    const token = process.env.DISCORD_TOKEN;
    if (!token) return null;
    const key = `discord-profile:${id}`;
    try {
        const cache = getCache();
        const cached = await cache.get(key);
        if (cached) return JSON.parse(cached) as DiscordProfile;
        const response = await fetch(`https://discord.com/api/v10/users/${id}`, {
            headers: { Authorization: `Bot ${token}` },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error(`Discord profile request failed (${response.status})`);
        const user = await response.json() as { id?: unknown; username?: unknown; avatar?: unknown; discriminator?: unknown };
        if (user.id !== id || typeof user.username !== "string" ||
            !(user.avatar === null || typeof user.avatar === "string" && /^(?:a_)?[a-f0-9]{32}$/.test(user.avatar))) {
            throw new Error("Discord returned an invalid user profile");
        }
        const defaultIndex = typeof user.discriminator === "string" && /^\d{4}$/.test(user.discriminator) && user.discriminator !== "0"
            ? Number(user.discriminator) % 5 : Number((BigInt(id) >> 22n) % 6n);
        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
            : `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
        const profile = { username: user.username, avatarUrl };
        await cache.set(key, JSON.stringify(profile), { EX: 3600 });
        return profile;
    } catch (error) {
        console.error("Could not load Discord profile:", error);
        return null;
    }
}
