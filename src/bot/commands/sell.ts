import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { sellPlayerItem } from "../../itemStorage.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("sell")
        .setDescription("Sell items from your inventory for their listed price.")
        .addStringOption(option => option.setName("item").setDescription("Item to sell").setRequired(true).setAutocomplete(true))
        .addIntegerOption(option => option.setName("quantity").setDescription("Number to sell (default 1)").setMinValue(1))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            const result = await sellPlayerItem(player.id, interaction.options.getString("item", true), interaction.options.getInteger("quantity") ?? 1);
            if (result.status === "invalid") {
                await interaction.editReply("Choose a sellable item and a positive quantity.");
            } else if (result.status === "unowned") {
                await interaction.editReply(`You do not have enough of that item (you own ${result.owned}).`);
            } else {
                await interaction.editReply(`Sold ${result.amount} × **${result.item.name}** for $${result.proceeds.toLocaleString()}.${result.unequipped ? " Your tool was unequipped." : ""}`);
            }
        } catch (error) {
            console.error("Sell command failed:", error);
            await interaction.editReply("Could not sell that item. Please try again.");
        }
    },
};
