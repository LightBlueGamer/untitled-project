import {
    InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
    type ChatInputCommandInteraction,
} from "discord.js";
import { debugTopics, isDebugEnabled, setDebugSetting } from "../../debugSettings.js";

export default {
    devMode: true,
    data: new SlashCommandBuilder()
        .setName("debug")
        .setDescription("Configure developer diagnostics.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setContexts(InteractionContextType.Guild)
        .addStringOption(option => option.setName("topic").setDescription("Diagnostic to configure").setRequired(true)
            .addChoices(
                { name: "Companion appearance chance (global)", value: "chance" },
                { name: "Message XP and money (global)", value: "rewards" },
                { name: "Casino outcomes (all players)", value: "gambling" },
                { name: "Lootbox chances and rewards (global)", value: "lootboxes" },
            ))
        .addStringOption(option => option.setName("action").setDescription("Enable, disable, or view status").setRequired(true)
            .addChoices({ name: "Enable", value: "on" }, { name: "Disable", value: "off" }, { name: "Status", value: "status" }))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const application = await interaction.client.application?.fetch();
            const owner = application?.owner;
            const ownerId = owner && "ownerId" in owner ? owner.ownerId : owner?.id;
            if (!ownerId || ownerId !== interaction.user.id) {
                await interaction.editReply("Only the bot application owner can use this command.");
                return;
            }
            const topic = interaction.options.getString("topic", true);
            const action = interaction.options.getString("action", true);
            const selected = debugTopics.find(item => item === topic);
            if (!selected || !["on", "off", "status"].includes(action)) {
                await interaction.editReply("Invalid debug option.");
                return;
            }
            if (action !== "status") await setDebugSetting(selected, action === "on");
            const enabled = await isDebugEnabled(selected);
            await interaction.editReply(`${selected} debug logging is ${enabled ? "enabled" : "disabled"} globally.`);
        } catch (error) {
            console.error("Failed to configure debug logging:", error);
            await interaction.editReply("Could not configure debug logging. Please try again.");
        }
    },
};
