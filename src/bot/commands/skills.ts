import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
    type ButtonInteraction, type ChatInputCommandInteraction,
} from "discord.js";
import Player from "../../classes/Player.js";
import { availableSkills, getSkill } from "../../resources/skills.js";
import { unlockSkill } from "../../skillStorage.js";

const pageSize = 5;

export function skillList(player: Player, requestedPage: number, notice = "") {
    const available = availableSkills(player.skills);
    const pages = Math.max(1, Math.ceil(available.length / pageSize));
    const page = Math.max(0, Math.min(requestedPage, pages - 1));
    const entries = available.slice(page * pageSize, (page + 1) * pageSize);
    const embed = new EmbedBuilder().setTitle("Available skills")
        .setDescription(entries.map(([, skill]) =>
            `**${skill.name}** · ${skill.cost} skill point${skill.cost === 1 ? "" : "s"}${player.skillPoints < skill.cost ? " · Not enough points" : ""}\n${skill.description}`,
        ).join("\n\n") || "No skills are currently available to unlock.")
        .setFooter({ text: `Page ${page + 1} of ${pages} · ${player.skillPoints} skill points available` });
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (entries.length) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(entries.map(([key, skill]) =>
            new ButtonBuilder().setCustomId(`skills:select:${player.id}:${page}:${key}:${player.prestigeLevel}`)
                .setLabel(skill.name).setStyle(ButtonStyle.Primary),
        )));
    }
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`skills:previous:${player.id}:${Math.max(0, page - 1)}:-:${player.prestigeLevel}`)
            .setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`skills:next:${player.id}:${Math.min(pages - 1, page + 1)}:-:${player.prestigeLevel}`)
            .setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
    ));
    return { content: notice, embeds: [embed], components };
}

export async function handleSkillButton(interaction: ButtonInteraction): Promise<void> {
    const match = /^skills:(select|confirm|cancel|previous|next):(\d+):(\d+):([a-z0-9_]+|-):(\d+)$/.exec(interaction.customId);
    if (!match || match[2] !== interaction.user.id) {
        await interaction.reply({ content: "This skill menu is invalid or does not belong to you.", flags: [MessageFlags.Ephemeral] });
        return;
    }
    const [, action, userId, pageText, key, prestigeText] = match;
    const page = Number(pageText);
    const prestige = Number(prestigeText);
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(prestige) ||
        ((action === "select" || action === "confirm") && !getSkill(key)) ||
        ((action === "previous" || action === "next") && key !== "-")) {
        await interaction.reply({ content: "This skill menu is invalid. Use /skills to open a new one.", flags: [MessageFlags.Ephemeral] });
        return;
    }
    await interaction.deferUpdate();
    const player = await Player.findById(userId);
    if (!player) {
        await interaction.editReply({ content: "Your player record no longer exists.", embeds: [], components: [] });
        return;
    }
    if (action === "confirm") {
        const result = await unlockSkill(userId, key, prestige);
        const messages = {
            unlocked: `Unlocked **${getSkill(key)!.name}**!`,
            invalid: "That skill no longer exists.",
            "not-found": "Your player record no longer exists.",
            "already-unlocked": "That skill is already unlocked.",
            prerequisites: "Unlock all prerequisites first.",
            "insufficient-points": "You do not have enough skill points to unlock that skill.",
            stale: "Your prestige changed. Select the skill again to confirm with your current progress.",
        };
        const updated = await Player.findById(userId);
        if (!updated) {
            await interaction.editReply({ content: messages[result.status], embeds: [], components: [] });
            return;
        }
        await interaction.editReply(skillList(updated, page, messages[result.status]));
        return;
    }
    if (action === "select") {
        const skill = getSkill(key)!;
        if (player.prestigeLevel !== prestige || !availableSkills(player.skills).some(([availableKey]) => availableKey === key)) {
            await interaction.editReply(skillList(player, page, "That selection is no longer available. Please choose again."));
            return;
        }
        const embed = new EmbedBuilder().setTitle(`Unlock ${skill.name}?`)
            .setDescription(`${skill.description}\n\nCost: **${skill.cost}** skill point${skill.cost === 1 ? "" : "s"} · You have **${player.skillPoints}**.${player.skillPoints < skill.cost ? "\nYou do not have enough points yet." : ""}`);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`skills:confirm:${userId}:${page}:${key}:${player.prestigeLevel}`)
                .setLabel("Confirm unlock").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`skills:cancel:${userId}:${page}:${key}:${player.prestigeLevel}`)
                .setLabel("Cancel").setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply({ content: "", embeds: [embed], components: [row] });
        return;
    }
    await interaction.editReply(skillList(player, page, action === "cancel" ? "Unlock cancelled." : ""));
}

export default {
    devMode: false,
    data: new SlashCommandBuilder().setName("skills").setDescription("View and unlock your available skills.").toJSON(),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const player = await Player.get(interaction.user.id, interaction.client);
        await interaction.editReply(skillList(player, 0));
    },
};
