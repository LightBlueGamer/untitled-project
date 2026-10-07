import { Client, ActivityType } from "discord.js";

export default {
    name: "clientReady",
    once: true,
    async execute(client: Client) {
        if (!client.user) return console.error(`No client user was found.`);

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