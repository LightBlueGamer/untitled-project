import {
    type GuildTextBasedChannel,
    type Message,
} from "discord.js";
import Player, { PlayerConflictError, type MessageRewardResult } from "../../classes/Player.js";
import { handleEncounterMessage } from "../companionEncounters.js";
import { debugLog } from "../../debugSettings.js";

const cd = new Set();

export default {
    name: "messageCreate",
    once: false,
    async execute(message: Message) {
        const { member } = message;

        if (!member || member.user.bot) return;
        try {
            if (await handleEncounterMessage(message)) return;
        } catch (error) {
            console.error("Failed to process companion encounter:", error);
        }
        if (!cd.has(member.id)) {
            cd.add(member.id);
            let result: MessageRewardResult;
            const rolls = new Map<string, number>();
            const random = (key: string) => {
                if (!rolls.has(key)) rolls.set(key, Math.random());
                return rolls.get(key)!;
            };
            try {
                for (let attempt = 0; ; attempt++) {
                    const player = await Player.get(member.id, message.client);
                    result = player.assignRandomExperienceAndBalance(random);
                    try {
                        await player.save();
                        break;
                    } catch (error) {
                        if (!(error instanceof PlayerConflictError) || attempt >= 2) throw error;
                    }
                }
            } catch (error) {
                cd.delete(member.id);
                console.error("Failed to award message rewards:", error);
                return;
            }
            setTimeout(() => {
                cd.delete(member.id);
            }, 30 * 1000);
            const {
                didLevelUp,
                previousLevel,
                currentLevel,
                skillPointsGained,
                player: updatedPlayer,
            } = result;
            debugLog("rewards", message.channelId,
                `Channel ${message.channelId}, player ${member.id}: ${result.experienceAwarded} XP, ${result.balanceAwarded} money, ${result.skillPointsGained + result.bonusSkillPoints} skill points`);

            for (const reward of result.specialRewards.filter((item) => item.announce)) {
                const rewards = [
                    reward.balance ? `$${reward.balance.toLocaleString()}` : null,
                    reward.experience ? `${reward.experience.toLocaleString()} XP` : null,
                    reward.skillPoints ? `${reward.skillPoints.toLocaleString()} skill point${reward.skillPoints === 1 ? "" : "s"}` : null,
                ].filter((item): item is string => item !== null);
                await (message.channel as GuildTextBasedChannel).send({
                    content: `${member}, ${reward.name}! You found ${rewards.join(" and ")}!`,
                });
            }

            if (didLevelUp) {
                const { canPrestige, currentRequirement } =
                    updatedPlayer.prestigeInfo;
                const reachedPrestigeRequirement =
                    previousLevel < currentRequirement &&
                    currentLevel >= currentRequirement;

                if (canPrestige && reachedPrestigeRequirement) {
                    await (message.channel as GuildTextBasedChannel).send({
                        content:
                            `${member}, congratulations! You've leveled up to level ${currentLevel} and earned ${skillPointsGained} skill point${skillPointsGained === 1 ? "" : "s"}! You can now prestige using the /prestige command!`,
                    });
                } else {
                    const levelUpMessage = await (
                        message.channel as GuildTextBasedChannel
                    ).send({
                        content: `${member}, congratulations! You've leveled up to level ${currentLevel} and earned ${skillPointsGained} skill point${skillPointsGained === 1 ? "" : "s"}! 🎉`,
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