import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { getLootboxInventory, openLootbox, useLootboxBoost } from "../../lootboxStorage.js";
import { companions } from "../../resources/companions.js";
import { items } from "../../resources/items.js";
import { describeLootboxBoost } from "../../resources/lootboxes.js";
import { websiteUrl } from "../website.js";
import { debugLog } from "../../debugSettings.js";

export default {
    devMode: false,
    data: new SlashCommandBuilder()
        .setName("lootbox")
        .setDescription("View and open lootboxes or use their boosts.")
        .addSubcommand(sub => sub.setName("list").setDescription("View your lootboxes and boosts"))
        .addSubcommand(sub => sub.setName("open").setDescription("Open a lootbox")
            .addStringOption(option => option.setName("box").setDescription("Lootbox to open").setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName("boost").setDescription("Activate a lootbox boost")
            .addStringOption(option => option.setName("boost").setDescription("Boost to use").setRequired(true).setAutocomplete(true)))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const player = await Player.get(interaction.user.id, interaction.client);
            const action = interaction.options.getSubcommand();
            if (action === "list") {
                const { boxes, boosts } = await getLootboxInventory(player.id);
                const boxLines = boxes.slice(0, 15).map(box =>
                    `#${box.id}: ${box.rarity}${box.pending_reward ? " (item waiting for space)" : ""}`);
                const boostLines = boosts.slice(0, 10).map(boost =>
                    `#${boost.id}: ${describeLootboxBoost(boost.bonus_type)} ×${boost.multiplier.toFixed(2)} for ${boost.duration_minutes} min`);
                await interaction.editReply(`**Lootboxes (${boxes.length})**\n${boxLines.join("\n") || "None"}${boxes.length > 15 ? "\nMore available in open autocomplete." : ""}\n\n**Boosts (${boosts.length})**\n${boostLines.join("\n") || "None"}${boosts.length > 10 ? "\nMore available in boost autocomplete." : ""}`);
            } else if (action === "open") {
                const boxId = interaction.options.getString("box", true);
                const result = await openLootbox(player.id, boxId);
                if (result.status !== "missing") {
                    const reward = result.reward;
                    const description = reward.type === "item"
                        ? `item ${items[reward.key].name} (${reward.key}, ${items[reward.key].rarity})`
                        : reward.type === "companion"
                            ? `companion ${companions[reward.key].name} (${reward.key}, ${companions[reward.key].rarity})`
                            : `boost ${describeLootboxBoost(reward.bonus)} x${reward.multiplier.toFixed(2)} for ${reward.durationMinutes} minutes`;
                    debugLog("lootboxes", interaction.channelId,
                        `${result.rarity} lootbox #${boxId}: ${description}; ${result.status === "full" ? "reward saved, backpack full" : "reward awarded"}${result.previouslyPending ? " (previously saved reward)" : ""}`,
                        { userId: interaction.user.id, username: interaction.user.username, guild: interaction.guild?.name,
                            channel: interaction.channel && "name" in interaction.channel ? interaction.channel.name ?? undefined : undefined });
                }
                if (result.status === "missing") {
                    await interaction.editReply("You do not own that lootbox.");
                } else if (result.status === "full") {
                    await interaction.editReply("Your backpack is full. This box's item reward is saved; free a slot with `/sell` or `/use`, then open the same box again.");
                } else {
                    const reward = result.reward;
                    if (reward.type === "item") {
                        await interaction.editReply(`You found **${items[reward.key].name}**! ${websiteUrl(`/item?key=${encodeURIComponent(reward.key)}`)}`);
                    } else if (reward.type === "companion") {
                        await interaction.editReply(`You found **${companions[reward.key].name}**! ${websiteUrl(`/companion?key=${encodeURIComponent(reward.key)}`)}`);
                    } else {
                        await interaction.editReply(`You found a boost: **${describeLootboxBoost(reward.bonus)} ×${reward.multiplier.toFixed(2)}** for ${reward.durationMinutes} minutes. Activate it with \`/lootbox boost\`.`);
                    }
                }
            } else if (action === "boost") {
                const boost = await useLootboxBoost(player.id, interaction.options.getString("boost", true));
                await interaction.editReply(boost
                    ? `Activated **${describeLootboxBoost(boost.bonus_type)} ×${boost.multiplier.toFixed(2)}** for ${boost.duration_minutes} minutes.`
                    : "You do not own that boost.");
            }
        } catch (error) {
            console.error("Lootbox command failed:", error);
            await interaction.editReply("Could not manage your lootboxes. Please try again.");
        }
    },
};
