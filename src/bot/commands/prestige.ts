import { ButtonBuilder, ActionRowBuilder, ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, MessageActionRowComponentBuilder } from "discord.js";
import Player from "../../classes/Player.js";
import { getMultipleRandomPrestigeBuffs } from "../../resources/functions.js";
import { PrestigeBuffs } from "../../resources/prestigeBuffs.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("prestige")
        .setDescription("Prestige your player to gain buffs and reset your progress.")
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        const { user, client } = interaction;
        const player = await Player.get(user.id, client);

        if(!player.prestigeInfo.canPrestige) {
            return interaction.reply({
                content: `You need to be level ${player.prestigeInfo.currentRequirement} to prestige. You currently are level ${player.level}.`,
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            let buffs;
            if(player.hasExistingBuffChoices) buffs = player.temporaryPrestigeBuffData!;
            else {
                buffs = getMultipleRandomPrestigeBuffs(3, PrestigeBuffs.filter(buff =>
                    buff.id !== 29 || !player.hasPrestigeCompanionSlot));
                await player.addTemporaryPrestigeBuffData(buffs).save();
            }
            const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                buffs.map(buff => new ButtonBuilder()
                    .setCustomId(`prestige_buff_${buff.id}`)
                    .setLabel(buff.name)
                    .setStyle(1)
                )
            );
            return interaction.reply({
                content: `You can prestige to prestige level ${player.prestigeLevel+1} and earn a buff and a random lootbox. This resets your XP, level, unlocked skills, and unspent skill points. Select a buff below to prestige!\n\n${buffs.map(buff => `**${buff.name}**: ${buff.description}`).join("\n")}`,
                components: [actionRow],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
