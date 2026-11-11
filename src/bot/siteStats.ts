import type { Client, Guild } from "discord.js";
import { getCache } from "../database.js";
import { websiteDiscordStatsKey } from "../websiteStats.js";

export async function getHumanMemberIds(guild: Guild): Promise<Set<string>> {
    const members = await guild.members.fetch();
    return new Set(
        [...members.values()]
            .filter(member => !member.user.bot)
            .map(member => member.id),
    );
}

export async function publishWebsiteDiscordStats(
    client: Client,
    membersByGuild: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
    const uniqueUsers = new Set<string>();
    for (const members of membersByGuild.values()) {
        for (const id of members) uniqueUsers.add(id);
    }

    await getCache().set(websiteDiscordStatsKey, JSON.stringify({
        guildCount: client.guilds.cache.size,
        uniqueUsers: uniqueUsers.size,
        updatedAt: new Date().toISOString(),
    }));
}
