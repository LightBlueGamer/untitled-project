import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { consumePlayerItem } from "../../itemStorage.js";
import { items } from "../../resources/items.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("use")
        .setDescription("Use a consumable item to gain a temporary scavenging bonus.")
        .addStringOption(option => option.setName("item").setDescription("Choose a consumable you own")
            .setRequired(true).setAutocomplete(true))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            const key = interaction.options.getString("item", true);
            const item = items[key];
            const result = await consumePlayerItem(player.id, key);
            if (result === "unowned") {
                await interaction.editReply("You do not have that item in your inventory.");
                return;
            }
            if (result === "not-consumable" || !item?.consumableBonus) {
                await interaction.editReply("That item cannot be used as a consumable.");
                return;
            }
            const { type, multiplier, durationMinutes } = item.consumableBonus;
            const effect = type === "scavengeRarity"
                ? `${Math.round((multiplier - 1) * 100)}% more Rare-or-higher weight`
                : `${Math.round(multiplier * 100)}% chance of an extra item`;
            await interaction.editReply(`Used **${item.name}**: ${effect} for ${durationMinutes} minutes.`);
        } catch (error) {
            console.error("Use command failed:", error);
            await interaction.editReply("Could not use that item. Please try again.");
        }
    },
};
