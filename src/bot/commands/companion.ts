import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
    type ButtonInteraction, type ChatInputCommandInteraction,
} from "discord.js";
import Player from "../../classes/Player.js";
import { equipCompanion, unequipCompanion } from "../../companionStorage.js";
import { getCompanion } from "../../resources/companions.js";

const pageSize = 10;

export function companionList(player: Player, requestedPage: number) {
    const inventory = player.companions;
    const pages = Math.max(1, Math.ceil(inventory.length / pageSize));
    const page = Math.max(0, Math.min(requestedPage, pages - 1));
    const entries = inventory.slice(page * pageSize, (page + 1) * pageSize);
    const description = entries.map(({ key, quantity }) => {
        const companion = getCompanion(key);
        if (!companion) return `**${key}** ×${quantity}\nDetails unavailable for this retired companion.`;
        const { HP, DMG, DEF, SPD, CRIT } = companion.stats;
        const equipped = player.equippedCompanions.includes(key) ? " · Equipped" : "";
        return `**${companion.name}** ×${quantity} (${companion.rarity}${equipped})\nHP ${HP} · DMG ${DMG} · DEF ${DEF} · SPD ${SPD} · CRIT ${CRIT}\n${companion.description}`;
    }).join("\n\n") || "You have no companions yet.";
    const embed = new EmbedBuilder().setTitle("Your companions").setDescription(description)
        .setFooter({ text: `Page ${page + 1} of ${pages} · ${player.equippedCompanions.length}/${player.companionSlots} equipped` });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`companion_list:${player.id}:${Math.max(0, page - 1)}`)
            .setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`companion_list:${player.id}:${Math.min(pages - 1, page + 1)}`)
            .setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
    );
    return { embeds: [embed], components: [row] };
}

export async function handleCompanionListButton(interaction: ButtonInteraction): Promise<void> {
    const match = /^companion_list:(\d+):(\d+)$/.exec(interaction.customId);
    if (!match || match[1] !== interaction.user.id) {
        await interaction.reply({ content: "This companion list is not yours.", flags: [MessageFlags.Ephemeral] });
        return;
    }
    const player = await Player.findById(interaction.user.id);
    if (!player) {
        await interaction.reply({ content: "Your player record no longer exists.", flags: [MessageFlags.Ephemeral] });
        return;
    }
    await interaction.update(companionList(player, Number(match[2])));
}

export default {
    devMode: false,
    data: new SlashCommandBuilder().setName("companion").setDescription("Manage your companions.")
        .addSubcommand(command => command.setName("list").setDescription("View your owned companions."))
        .addSubcommand(command => command.setName("equip").setDescription("Equip an owned companion.")
            .addStringOption(option => option.setName("companion").setDescription("Choose a companion")
                .setRequired(true).setAutocomplete(true)))
        .addSubcommand(command => command.setName("unequip").setDescription("Unequip a companion.")
            .addStringOption(option => option.setName("companion").setDescription("Choose an equipped companion")
                .setRequired(true).setAutocomplete(true)))
        .toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const subcommand = interaction.options.getSubcommand();
            if (subcommand === "list") {
                const player = await Player.get(interaction.user.id, interaction.client);
                await interaction.editReply(companionList(player, 0));
                return;
            }
            const key = interaction.options.getString("companion", true);
            const companion = getCompanion(key);
            if (!companion) {
                await interaction.editReply({ content: "That companion does not exist." });
                return;
            }
            await Player.get(interaction.user.id, interaction.client);
            const result = subcommand === "unequip"
                ? await unequipCompanion(interaction.user.id, key)
                : await equipCompanion(interaction.user.id, key);
            const messages = {
                equipped: `Equipped ${companion.name}! ${companion.description}`,
                unowned: "You do not own that companion.",
                "already-equipped": "That companion is already equipped.",
                full: "All companion slots are full. Use /companion unequip first.",
                unequipped: `Unequipped ${companion.name}.`,
                "not-equipped": "That companion is not equipped.",
            };
            await interaction.editReply({
                content: messages[result],
            });
        } catch (error) {
            console.error("Failed to manage companions:", error);
            await interaction.editReply({ content: "Could not manage your companions. Please try again." });
        }
    },
};
