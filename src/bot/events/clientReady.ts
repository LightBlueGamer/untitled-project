import { Client, ActivityType } from "discord.js";
import { restoreCompanionEncounters } from "../companionEncounters.js";

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