import { escapeMarkdown } from "discord.js";

export function playerMention(name: string, mention: string): string {
    return `**${escapeMarkdown(name).replaceAll("@", "@\u200b")}** (${mention})`;
}
