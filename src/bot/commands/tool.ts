import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { equipPlayerTool, getPlayerScavengeState, unequipPlayerTool } from "../../itemStorage.js";
import { tools } from "../../resources/items.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("tool")
        .setDescription("Manage scavenging tools.")
        .addSubcommand(command => command.setName("equip").setDescription("Equip an owned scavenging tool.")
            .addStringOption(option => option.setName("tool").setDescription("Choose a tool")
                .setRequired(true).setAutocomplete(true)))
        .addSubcommand(command => command.setName("unequip").setDescription("Unequip one of your scavenging tools.")
            .addStringOption(option => option.setName("tool").setDescription("Choose an equipped tool")
                .setRequired(true).setAutocomplete(true)))
        .addSubcommand(command => command.setName("list").setDescription("View your equipped scavenging tools."))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === "list") {
                const state = await getPlayerScavengeState(player.id, player.toolSlots);
                const equipped = state.equippedTools.map(key => tools[key]?.name ?? key);
                await interaction.editReply(
                    `Equipped tools (${equipped.length}/${player.toolSlots}): ${equipped.join(", ") || "None"}`,
                );
                return;
            }
            const key = interaction.options.getString("tool", true);
            const tool = tools[key];
            if (!tool) {
                await interaction.editReply("That tool does not exist.");
                return;
            }
            if (subcommand === "unequip") {
                const result = await unequipPlayerTool(player.id, key);
                await interaction.editReply(result === "unequipped"
                    ? `Unequipped **${tool.name}**.`
                    : `**${tool.name}** is not equipped.`);
                return;
            }
            const result = await equipPlayerTool(player.id, key, player.toolSlots);
            const messages = {
                equipped: `Equipped **${tool.name}**. ${tool.description} (${player.toolSlots} tool slot${player.toolSlots === 1 ? "" : "s"} available.)`,
                unowned: "You do not own that tool. Find it by scavenging or craft it from the item catalog.",
                "already-equipped": "That tool is already equipped.",
                full: `You have used all ${player.toolSlots} tool slot${player.toolSlots === 1 ? "" : "s"}. Unlock Tool Mastery to equip another.`,
            };
            await interaction.editReply(messages[result]);
        } catch (error) {
            console.error("Tool command failed:", error);
            await interaction.editReply("Could not manage your tools. Please try again.");
        }
    },
};
