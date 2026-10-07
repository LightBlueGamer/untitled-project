import type { GuildTextBasedChannel, Message } from "discord.js";
import Player from "../../classes/Player.js";

const cd = new Set();

export default {
    name: "messageCreate",
    once: false,
    async execute(message: Message) {
        const { member } = message;

        if (!member || member.user.bot) return;
        const player = await Player.get(member.id, message.client);
        
        if (!cd.has(member.id)) {
            const { didLevelUp, currentLevel, player: updatedPlayer } = player.assignRandomExperienceAndBalance();
            if ( didLevelUp ) (message.channel as GuildTextBasedChannel).send({
                    content: `${member}, congratulations! You've leveled up to level ${currentLevel}! 🎉`,
                });
            cd.add(member.id);
            setTimeout(() => {
                cd.delete(member.id);
            }, 15 * 1000);
            await updatedPlayer.save();
        }
    },
};