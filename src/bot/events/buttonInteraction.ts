import { ButtonComponent, ButtonInteraction, MessageFlags } from "discord.js";
import Player, { PlayerConflictError } from "../../classes/Player.js";
import { PrestigeBuff } from "../../resources/prestigeBuffs.js";
import { getPrestigeBuff } from "../../resources/functions.js";
import { handleCompanionListButton } from "../commands/companion.js";
import { handleCatchButton } from "../companionEncounters.js";
import { getCompanion } from "../../resources/companions.js";
import { getLootboxBonuses, savePlayerWithLootbox } from "../../lootboxStorage.js";
import { rollLootboxRarity } from "../../resources/lootboxes.js";
import { type Rarity } from "../../resources/rarities.js";
import { debugLog } from "../../debugSettings.js";
import { handleSkillButton } from "../commands/skills.js";

export default {
    name: "buttonInteraction",
    once: false,
    async execute(interaction: ButtonInteraction) {
        const { user, client } = interaction;
        if (user.bot) return;

        if (interaction.customId.startsWith("skills:")) {
            try {
                await handleSkillButton(interaction);
            } catch (error) {
                console.error("Failed to handle skill interaction:", error);
                const content = "Could not complete the skill action. The unlock may have succeeded; use /skills to check your current progress.";
                if (interaction.deferred) await interaction.editReply({ content, embeds: [], components: [] });
                else if (!interaction.replied) await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        if (interaction.customId.startsWith("companion_catch:")) {
            try {
                await handleCatchButton(interaction);
            } catch (error) {
                console.error("Failed to catch companion:", error);
                if (interaction.deferred) await interaction.editReply("Could not catch the companion. Please try again.");
                else if (!interaction.replied) await interaction.reply({ content: "Could not catch the companion. Please try again.", flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        if (interaction.customId.startsWith("companion_list:")) {
            try {
                await handleCompanionListButton(interaction);
            } catch (error) {
                console.error("Failed to load companion list:", error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "Could not load your companions. Please try again.", flags: [MessageFlags.Ephemeral] });
                }
            }
            return;
        }

        if(interaction.customId.startsWith("prestige_buff_")) {
            try {
                const buff: PrestigeBuff = getPrestigeBuff(interaction.customId.split("_")[2]);
                let unequipped: string[] = [];
                let lootbox: Rarity;
                const roll = Math.random();
                for (let attempt = 0; ; attempt++) {
                    const player = await Player.get(user.id, client);
                    if (!player.prestigeInfo.canPrestige ||
                        !player.temporaryPrestigeBuffData?.some((choice) => choice.id === buff.id)) {
                        await interaction.reply({
                            content: "This prestige choice is no longer available. Use /prestige to check your current options.",
                            flags: [MessageFlags.Ephemeral],
                        });
                        return;
                    }
                    const bonuses = await getLootboxBonuses(player.id);
                    lootbox = rollLootboxRarity("prestige", player.prestigeLevel + 1,
                        player.lootboxRarityMultiplier * bonuses.lootboxRarity, () => roll);
                    const previouslyEquipped = player.equippedCompanions;
                    player.prestige(() => buff.buff(player)).clearTemporaryPrestigeBuffData();
                    unequipped = previouslyEquipped.filter(key => !player.equippedCompanions.includes(key));
                    try {
                        await savePlayerWithLootbox(player, lootbox);
                        break;
                    } catch (error) {
                        if (!(error instanceof PlayerConflictError) || attempt >= 2) throw error;
                    }
                }
                debugLog("lootboxes", interaction.channelId,
                    `Prestige lootbox chance: 100% (guaranteed); awarded ${lootbox} lootbox`,
                    { userId: user.id, username: user.username, guild: interaction.guild?.name,
                        channel: interaction.channel && "name" in interaction.channel ? interaction.channel.name ?? undefined : undefined });
                await interaction.reply({
                    content: `You selected the ${(interaction.component as ButtonComponent).label} buff! Your experience, level, skills, and skill points have been reset, but you kept your money. ${buff.description} You received a **${lootbox} lootbox**; open it with \`/lootbox open\`.${unequipped.length ? ` Unequipped due to lost slots: ${unequipped.map(key => getCompanion(key)?.name ?? key).join(", ")}.` : ""}`,
                    flags: [MessageFlags.Ephemeral]
                });
            } catch (error) {
                console.error("Failed to prestige:", error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "Could not prestige. Please try again.",
                        flags: [MessageFlags.Ephemeral],
                    });
                }
            }
        }
    },
};