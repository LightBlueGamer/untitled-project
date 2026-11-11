import { Client, ActivityType, Events, type Guild } from "discord.js";
import { restoreCompanionEncounters } from "../companionEncounters.js";
import { getHumanMemberIds, publishWebsiteDiscordStats } from "../siteStats.js";

export default {
    name: "clientReady",
    once: true,
    async execute(client: Client) {
        if (!client.user) return console.error(`No client user was found.`);
        try {
            await restoreCompanionEncounters(client);
        } catch (error) {
            console.error("Failed to restore companion encounters:", error);
        }

        const membersByGuild = new Map<string, Set<string>>();
        const publishStats = () => {
            if (membersByGuild.size !== client.guilds.cache.size) return;
            void publishWebsiteDiscordStats(client, membersByGuild).catch(error => {
                console.error("Failed to publish website Discord stats:", error);
            });
        };
        const refreshGuildMembers = async (guild: Guild) => {
            try {
                membersByGuild.set(guild.id, await getHumanMemberIds(guild));
                if (membersByGuild.size === client.guilds.cache.size) {
                    await publishWebsiteDiscordStats(client, membersByGuild);
                }
            } catch (error) {
                console.error(`Failed to refresh website member stats for guild ${guild.id}:`, error);
            }
        };
        const refreshMissingGuildMembers = async () => {
            for (const guild of client.guilds.cache.values()) {
                if (!membersByGuild.has(guild.id)) await refreshGuildMembers(guild);
            }
        };

        try {
            for (const guild of client.guilds.cache.values()) {
                membersByGuild.set(guild.id, await getHumanMemberIds(guild));
            }
            await publishWebsiteDiscordStats(client, membersByGuild);
        } catch (error) {
            console.error("Failed to publish initial website Discord stats:", error);
        }

        client.on(Events.GuildMemberAdd, member => {
            if (member.user.bot) return;
            membersByGuild.get(member.guild.id)?.add(member.id);
            publishStats();
        });
        client.on(Events.GuildMemberRemove, member => {
            membersByGuild.get(member.guild.id)?.delete(member.id);
            publishStats();
        });
        client.on(Events.GuildCreate, guild => {
            void refreshGuildMembers(guild);
        });
        client.on(Events.GuildDelete, guild => {
            membersByGuild.delete(guild.id);
            publishStats();
        });
        setInterval(() => {
            if (membersByGuild.size !== client.guilds.cache.size) {
                void refreshMissingGuildMembers();
            } else {
                publishStats();
            }
        }, 15 * 60 * 1000);

        setInterval(() => {
            client.user?.setPresence({
                status: "online",
                activities: [
                    {
                        name: `CustomStatus`,
                        type: ActivityType.Custom,
                        state: `Prestigious - Watching ${client.guilds.cache.size} worlds with ${client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)} players!`,
                    },
                ],
            });
        }, 1000 * 15);

        console.log(`Bot is running as ${client.user.username}.`);
    },
};