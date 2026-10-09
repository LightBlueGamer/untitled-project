import {
    type GuildTextBasedChannel,
    type Message,
} from "discord.js";
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
            const {
                didLevelUp,
                previousLevel,
                currentLevel,
                player: updatedPlayer,
            } = player.assignRandomExperienceAndBalance();
            cd.add(member.id);
            setTimeout(() => {
                cd.delete(member.id);
            }, 30 * 1000);
            await updatedPlayer.save();

            if (didLevelUp) {
                const { canPrestige, currentRequirement } =
                    updatedPlayer.prestigeInfo;
                const reachedPrestigeRequirement =
                    previousLevel < currentRequirement &&
                    currentLevel >= currentRequirement;

                if (canPrestige && reachedPrestigeRequirement) {
                    await (message.channel as GuildTextBasedChannel).send({
                        content:
                            `${member}, congratulations! You've leveled up to level ${currentLevel}! 🎉\n` +
                            `You can prestige to reset your level and XP, gain a prestige level, and receive one of three random buffs!`,
                    });
                } else {
                    const levelUpMessage = await (
                        message.channel as GuildTextBasedChannel
                    ).send({
                        content: `${member}, congratulations! You've leveled up to level ${currentLevel}! 🎉`,
                    });
                    setTimeout(() => {
                        void levelUpMessage.delete().catch((error: unknown) => {
                            console.error(
                                "Failed to delete level-up message:",
                                error,
                            );
                        });
                    }, 10 * 1000);
                }
            }
        }
    },
};