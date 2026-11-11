import { ApplicationIntegrationType, InteractionContextType } from "discord.js";
import type { Command } from "../classes/Command.js";

export function publicCommandData(data: Command.Data): Command.Data {
    return {
        ...data,
        integration_types: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
        contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
    };
}
