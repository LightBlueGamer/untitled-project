import { commands } from "../../index.js";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

export default {
    name: "chatInputCommandInteraction",
    once: false,
    async execute(interaction: ChatInputCommandInteraction) {
        const { user } = interaction;

        if (user.bot) return;

        const command = commands.get(interaction.commandName);
        if (!command) {
            console.error(`No handler loaded for command: ${interaction.commandName}`);
            await interaction.reply({
                content: "This command is not available on the running bot. Please contact an administrator.",
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Command ${interaction.commandName} failed:`, error);
            if (interaction.deferred) {
                await interaction.editReply({ content: "The command failed. Please try again." });
            } else if (!interaction.replied) {
                await interaction.reply({
                    content: "The command failed. Please try again.",
                    flags: [MessageFlags.Ephemeral],
                });
            }
        } finally {
            const string = `Command ${interaction.commandName} was used by ${interaction.user.tag} at ${new Date().toDateString()}`;
            console.log(string);
        }
    },
};