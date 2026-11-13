import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { websiteUrl } from "../website.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Learn how to play and find the game guide.")
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle("Prestigious Ledger Help")
            .setDescription(`Earn XP and money by chatting, spend skill points in your skill tree, catch companions, and prestige to gain powerful buffs.\n\n[Open the full game guide](${websiteUrl("/wiki")})`)
            .addFields(
                { name: "Progression", value: "`/skills` — view and unlock available skills. `/prestige` — prestige when you meet the level requirement." },
                { name: "Companions", value: "`/companion list`, `/companion equip`, and `/companion unequip` — manage your collection." },
                { name: "Scavenging", value: "`/scavenge` to find items, `/tool equip` to use a tool, `/craft` to make equipment or upgrade your 10-slot pouch, `/use` to activate consumables, and `/sell` to free inventory space." },
                { name: "Lootboxes", value: "Find lootboxes from rewarded messages or prestige. Use `/lootbox list`, `/lootbox open`, and `/lootbox boost` to manage them." },
            );
        await interaction.reply({ embeds: [embed] });
    },
};
