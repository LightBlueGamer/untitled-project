import { ButtonBuilder, ActionRowBuilder, ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, MessageActionRowComponentBuilder } from "discord.js";
import Player from "../../classes/Player.js";
import { getMultipleRandomPrestigeBuffs } from "../../resources/functions.js";

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
                buffs = getMultipleRandomPrestigeBuffs(3);
                player.addTemporaryPrestigeBuffData(buffs).save();
            }
            const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                buffs.map(buff => new ButtonBuilder()
                    .setCustomId(`prestige_buff_${buff.id}`)
                    .setLabel(buff.name)
                    .setStyle(1)
                )
            );
            return interaction.reply({
                content: `You can prestige to prestige level ${player.prestigeLevel+1} and select earn a buff while reseting your XP and Level. Select a buff from below to prestige!`,
                components: [actionRow],
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};
