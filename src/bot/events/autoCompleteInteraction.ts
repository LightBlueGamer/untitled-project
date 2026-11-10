import type { AutocompleteInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { getCompanion } from "../../resources/companions.js";

export default {
    name: "autoCompleteInteraction",
    once: false,
    async execute(interaction: AutocompleteInteraction) {
        if (interaction.commandName !== "companion") return;
        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== "equip" && subcommand !== "unequip") return;
        try {
            const player = await Player.findById(interaction.user.id);
            const search = interaction.options.getFocused().toLowerCase();
            const choices = (player?.companions ?? []).flatMap(({ key }) => {
                const companion = getCompanion(key);
                if (subcommand === "unequip" && !player?.equippedCompanions.includes(key)) return [];
                if (!companion || !`${companion.name} ${key}`.toLowerCase().includes(search)) return [];
                return [{ name: companion.name, value: key }];
            }).slice(0, 25);
            await interaction.respond(choices);
        } catch (error) {
            console.error("Failed to load companion choices:", error);
            await interaction.respond([]);
        }
    },
};
