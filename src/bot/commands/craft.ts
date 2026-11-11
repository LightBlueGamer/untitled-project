import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { craftPlayerItem } from "../../itemStorage.js";
import { BackpackUpgrade, CraftableItem, ItemCategory } from "../../resources/items.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("craft")
        .setDescription("Craft an item or scavenging tool from your inventory.")
        .addStringOption(option => option.setName("item").setDescription("Choose an item to craft")
            .setRequired(true).setAutocomplete(true))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            const result = await craftPlayerItem(player.id, interaction.options.getString("item", true));
            if (result.status === "not-craftable") {
                await interaction.editReply("That item does not have a crafting recipe.");
            } else if (result.status === "missing") {
                await interaction.editReply(`You need ${result.needed} × **${result.item.name}** but only have ${result.owned}.`);
            } else {
                const toolNote = result.item instanceof CraftableItem && result.item.category === ItemCategory.Tool
                    ? " Equip it with `/tool equip`."
                    : "";
                const backpackNote = result.item instanceof BackpackUpgrade
                    ? ` It replaces your previous backpack and holds ${result.item.capacity} items.`
                    : "";
                await interaction.editReply(`Crafted **${result.item.name}**!${toolNote}${backpackNote}`);
            }
        } catch (error) {
            console.error("Craft command failed:", error);
            await interaction.editReply("Could not craft that item. Please try again.");
        }
    },
};
