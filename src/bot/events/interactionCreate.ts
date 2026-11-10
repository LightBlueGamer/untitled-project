import { InteractionType, type BaseInteraction } from "discord.js";
import Player from "../../classes/Player.js";

export default {
    name: "interactionCreate",
    once: false,
    async execute(interaction: BaseInteraction) {
        const { user, client } = interaction;
        if (user.bot) return;

        const companionInteraction =
            ((interaction.isChatInputCommand() || interaction.isAutocomplete()) && ["companion", "debug"].includes(interaction.commandName)) ||
            (interaction.isButton() && (interaction.customId.startsWith("companion_list:") || interaction.customId.startsWith("companion_catch:")));
        if (!companionInteraction) await Player.get(user.id, client);

        if (interaction.isChatInputCommand()) {
            return interaction.client.emit(
                "chatInputCommandInteraction",
                interaction
            );
        }
        if (interaction.isAutocomplete())
            return interaction.client.emit(
                "autoCompleteInteraction",
                interaction
            );

        if (interaction.isContextMenuCommand())
            return interaction.client.emit(
                "contextMenuCommandInteraction",
                interaction
            );

        if (interaction.type === InteractionType.ModalSubmit)
            return interaction.client.emit("modalSubmit", interaction);

        if (interaction.isButton()) 
            return interaction.client.emit("buttonInteraction", interaction);
    },
};