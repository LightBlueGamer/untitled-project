import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { scavengeForPlayer, type ScavengeResult } from "../../itemStorage.js";
import { tools } from "../../resources/items.js";
import { expireLevelUpMessage, levelUpMessage } from "../levelUp.js";
import { websiteUrl } from "../website.js";

export function formatRemaining(milliseconds: number): string {
    const seconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes ? `${minutes} minute${minutes === 1 ? "" : "s"} and ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}` :
        `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
}

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("scavenge")
        .setDescription("Search for a useful item; scavenging skills can reduce the cooldown.")
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();
        let result: ScavengeResult;
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            result = await scavengeForPlayer(player.id);
        } catch (error) {
            console.error("Scavenge command failed:", error);
            await interaction.editReply("Could not complete your scavenging attempt. Please try again.");
            return;
        }
        if (result.status === "cooldown") {
            await interaction.editReply(`You are still recovering from your last search. Try again in ${formatRemaining(result.remainingMs)}.`);
            return;
        }
        if (result.status === "full") {
            await interaction.editReply(`Your backpack is full (${result.used}/${result.capacity} slots). Sell items with \`/sell\` or use items to make space before scavenging.`);
            return;
        }
        try {
            const equipped = result.equippedTools.map(key => tools[key]?.name).filter(Boolean);
            const itemUrl = websiteUrl(`/item?key=${encodeURIComponent(result.key)}`);
            const embed = new EmbedBuilder()
                .setTitle("Scavenging results")
                .setDescription(`${interaction.user} found [${result.item.name}](${itemUrl}) ×${result.quantity}!`)
                .addFields(
                    { name: "Item", value: `${result.item.rarity} ${result.item.category}`, inline: true },
                    { name: "Value", value: `$${result.item.price.toLocaleString()} each`, inline: true },
                    { name: "Chance", value: `Approximately 1/${Math.round(result.odds).toLocaleString()} per search`, inline: true },
                    { name: "Experience earned", value: `${result.experienceAwarded.toLocaleString()} XP`, inline: true },
                );
            if (equipped.length) embed.addFields({ name: "Tools used", value: equipped.join(", ") });
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error("Failed to display saved scavenging result:", error);
            await interaction.editReply("Your scavenging rewards were saved, but the result could not be displayed.");
        }
        if (result.progression.didLevelUp) {
            try {
                const announcement = await interaction.followUp(levelUpMessage(String(interaction.user), result.progression));
                expireLevelUpMessage(() => interaction.webhook.deleteMessage(announcement.id));
            } catch (error) {
                console.error("Failed to announce scavenging level-up:", error);
            }
        }
    },
};
