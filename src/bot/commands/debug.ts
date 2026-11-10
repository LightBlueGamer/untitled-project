import {
    InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
    type ChatInputCommandInteraction,
} from "discord.js";
import { isDebugEnabled, setDebugSetting, type DebugTopic } from "../../debugSettings.js";

const topics: readonly DebugTopic[] = ["chance", "rewards", "gambling"];

export default {
    devMode: true,
    data: new SlashCommandBuilder()
        .setName("debug")
        .setDescription("Configure developer diagnostics.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setContexts(InteractionContextType.Guild)
        .addStringOption(option => option.setName("topic").setDescription("Diagnostic to configure").setRequired(true)
            .addChoices(
                { name: "Companion appearance chance (this channel)", value: "chance" },
                { name: "Message XP and money (this channel)", value: "rewards" },
                { name: "Casino outcomes (all players)", value: "gambling" },
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
            if (!topics.some(item => item === topic) || !["on", "off", "status"].includes(action)) {
                await interaction.editReply("Invalid debug option.");
                return;
            }
            const selected = topics.find(item => item === topic)!;
            const scope = selected === "gambling" ? "global" : interaction.channelId;
            if (action !== "status") await setDebugSetting(selected, scope, action === "on");
            const enabled = await isDebugEnabled(selected, scope);
            await interaction.editReply(`${selected} debug logging is ${enabled ? "enabled" : "disabled"} ${selected === "gambling" ? "globally" : "for this channel"}.`);
        } catch (error) {
            console.error("Failed to configure debug logging:", error);
            await interaction.editReply("Could not configure debug logging. Please try again.");
        }
    },
};
