import { ButtonComponent, ButtonInteraction, MessageFlags } from "discord.js";
import Player, { PlayerConflictError } from "../../classes/Player.js";
import { PrestigeBuff } from "../../resources/prestigeBuffs.js";
import { getPrestigeBuff } from "../../resources/functions.js";
import { handleCompanionListButton } from "../commands/companion.js";
import { handleCatchButton } from "../companionEncounters.js";
import { getCompanion } from "../../resources/companions.js";

export default {
    name: "buttonInteraction",
    once: false,
    async execute(interaction: ButtonInteraction) {
        const { user, client } = interaction;
        if (user.bot) return;

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
                    const previouslyEquipped = player.equippedCompanions;
                    player.prestige(() => buff.buff(player)).clearTemporaryPrestigeBuffData();
                    unequipped = previouslyEquipped.filter(key => !player.equippedCompanions.includes(key));
                    try {
                        await player.save();
                        break;
                    } catch (error) {
                        if (!(error instanceof PlayerConflictError) || attempt >= 2) throw error;
                    }
                }
                await interaction.reply({
                    content: `You selected the ${(interaction.component as ButtonComponent).label} buff! Your experience, level, skills, and skill points have been reset, but you kept your money. ${buff.description}${unequipped.length ? ` Unequipped due to lost slots: ${unequipped.map(key => getCompanion(key)?.name ?? key).join(", ")}.` : ""}`,
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