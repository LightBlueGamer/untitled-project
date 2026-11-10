import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";

function getWikiUrl(): string {
    const baseUrl = process.env.WEBSITE_URL || process.env.DISCORD_REDIRECT_URI || "http://localhost:3000";
    return new URL("/wiki", baseUrl).toString();
}

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Learn how to play and find the game guide.")
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle("Prestigious Ledger Help")
            .setDescription(`Earn XP and money by chatting, spend skill points in your skill tree, catch companions, and prestige to gain powerful buffs.\n\n[Open the full game guide](${getWikiUrl()})`)
            .addFields(
                { name: "Progression", value: "`/prestige` — prestige when you meet the level requirement." },
                { name: "Companions", value: "`/companion list`, `/companion equip`, and `/companion unequip` — manage your collection." },
            );
        await interaction.reply({ embeds: [embed] });
    },
};
