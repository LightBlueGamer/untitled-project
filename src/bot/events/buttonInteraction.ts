import { ButtonComponent, ButtonInteraction, MessageFlags } from "discord.js";
import Player from "../../classes/Player.js";
import { PrestigeBuff } from "../../resources/prestigeBuffs.js";
import { getPrestigeBuff } from "../../resources/functions.js";

export default {
    name: "buttonInteraction",
    once: false,
    async execute(interaction: ButtonInteraction) {
        const { user, client } = interaction;
        if (user.bot) return;

        const player = await Player.get(user.id, client);

        if(interaction.customId.startsWith("prestige_buff_")) {
            const buff: PrestigeBuff = getPrestigeBuff(interaction.customId.split("_")[2])
            buff.buff(player);
            player.prestige().clearTemporaryPrestigeBuffData().save();
            interaction.reply({
                content: `You selected the ${(interaction.component as ButtonComponent).label} buff! Your experience and level has been reset but you kept all your money!`,
                flags: [MessageFlags.Ephemeral]
            })
        }
    },
};