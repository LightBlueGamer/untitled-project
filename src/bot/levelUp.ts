import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { ExperienceResult } from "../classes/Player.js";
import { websiteUrl } from "./website.js";
import { playerMention } from "./playerName.js";

export function levelUpMessage(mention: string, result: ExperienceResult) {
    const { player, previousLevel, currentLevel, skillPointsGained } = result;
    const { canPrestige, currentRequirement } = player.prestigeInfo;
    const prestigeNotice = canPrestige && previousLevel < currentRequirement && currentLevel >= currentRequirement
        ? " You can now prestige using the /prestige command!" : "";
    const components = skillPointsGained > 0
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setLabel("Open skill tree").setStyle(ButtonStyle.Link).setURL(websiteUrl("/skills")),
        )]
        : [];
    return {
        content: `${playerMention(player.name, mention)}, congratulations! You've leveled up to level ${currentLevel} and earned ${skillPointsGained} skill point${skillPointsGained === 1 ? "" : "s"}! 🎉${prestigeNotice}`,
        components,
    };
}

export function expireLevelUpMessage(deleteMessage: () => Promise<unknown>): void {
    setTimeout(() => {
        void deleteMessage().catch((error: unknown) => console.error("Failed to delete level-up message:", error));
    }, 30_000);
}
