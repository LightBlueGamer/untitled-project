import { InteractionType, type BaseInteraction } from "discord.js";
import Player from "../../classes/Player.js";

export default {
    name: "interactionCreate",
    once: false,
    async execute(interaction: BaseInteraction) {
        const { user, client } = interaction;
        if (user.bot) return;

        (await Player.get(user.id, client)).save();

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