import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import {
    greenEmbed,
    orangeEmbed,
    redEmbed,
} from "../../resources/embeds.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Checks bot ping.")
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        const startTimestamp = Date.now();

        await interaction.reply({
            content: `Pinging...`,
        });

        const botLatency = Date.now() - startTimestamp;
        const apiLatency = interaction.client.ws.ping;

        let embed;
        if (botLatency < 150 && apiLatency < 150) {
            embed = greenEmbed();
        } else if (
            (botLatency < 150 && apiLatency > 150) ||
            (botLatency > 150 && apiLatency < 150)
        ) {
            embed = orangeEmbed();
        } else {
            embed = redEmbed();
        }

        embed.setTitle("Pong!").setFields([
            { name: "Bot Latency", value: `${botLatency}ms`, inline: true },
            { name: "API Latency", value: `${apiLatency}ms`, inline: true },
        ]);
        return interaction.editReply({ embeds: [embed], content: "" });
    },
};