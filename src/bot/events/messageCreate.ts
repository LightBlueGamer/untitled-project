import {
    type GuildTextBasedChannel,
    type Message,
} from "discord.js";
import Player, { PlayerConflictError, type MessageRewardResult } from "../../classes/Player.js";
import { handleEncounterMessage } from "../companionEncounters.js";
import { debugLog } from "../../debugSettings.js";
import { expireLevelUpMessage, levelUpMessage } from "../levelUp.js";
import { getLootboxBonuses, savePlayerWithLootbox } from "../../lootboxStorage.js";
import { lootboxDropChance, rollLootboxRarity } from "../../resources/lootboxes.js";
import { type Rarity } from "../../resources/rarities.js";

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
            let lootbox: Rarity | null = null;
            const rolls = new Map<string, number>();
            const random = (key: string) => {
                if (!rolls.has(key)) rolls.set(key, Math.random());
                return rolls.get(key)!;
            };
            try {
                for (let attempt = 0; ; attempt++) {
                    const player = await Player.get(member.id, message.client);
                    result = player.assignRandomExperienceAndBalance(random);
                    const bonuses = await getLootboxBonuses(player.id);
                    lootbox = random("lootbox-drop") < lootboxDropChance(player.lootboxDropMultiplier * bonuses.lootboxDrop)
                        ? rollLootboxRarity("message", player.prestigeLevel, player.lootboxRarityMultiplier * bonuses.lootboxRarity,
                            () => random("lootbox-rarity"))
                        : null;
                    try {
                        if (lootbox) await savePlayerWithLootbox(player, lootbox);
                        else await player.save();
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
            } = result;
            debugLog("rewards", message.channelId,
                `Channel ${message.channelId}, player ${member.id}: ${result.experienceAwarded} XP, ${result.balanceAwarded} money, ${result.skillPointsGained + result.bonusSkillPoints} skill points`);

            if (lootbox) {
                try {
                    await (message.channel as GuildTextBasedChannel).send({
                        content: `${member} found a **${lootbox} lootbox**! Use \`/lootbox list\` to view it and \`/lootbox open\` to open it.`,
                    });
                } catch (error) {
                    console.error("Failed to announce saved lootbox:", error);
                }
            }
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
                const announcement = await (message.channel as GuildTextBasedChannel)
                    .send(levelUpMessage(String(member), result));
                expireLevelUpMessage(() => announcement.delete());
            }
        }
    },
};