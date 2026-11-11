import type { AutocompleteInteraction } from "discord.js";
import Player from "../../classes/Player.js";
import { getCompanion } from "../../resources/companions.js";
import { getPlayerItems, getPlayerScavengeState } from "../../itemStorage.js";
import { CraftableItem, items, tools } from "../../resources/items.js";
import { getLootboxInventory } from "../../lootboxStorage.js";
import { describeLootboxBoost } from "../../resources/lootboxes.js";

export default {
    name: "autoCompleteInteraction",
    once: false,
    async execute(interaction: AutocompleteInteraction) {
        try {
            const search = interaction.options.getFocused().toLowerCase();
            if (interaction.commandName === "lootbox") {
                const action = interaction.options.getSubcommand();
                const { boxes, boosts } = await getLootboxInventory(interaction.user.id);
                const choices = action === "open"
                    ? boxes.map(box => ({ name: `${box.rarity} lootbox #${box.id}${box.pending_reward ? " (item waiting)" : ""}`, value: box.id }))
                    : action === "boost" ? boosts.map(boost => ({
                        name: `${describeLootboxBoost(boost.bonus_type)} ×${boost.multiplier.toFixed(2)} · ${boost.duration_minutes} min #${boost.id}`,
                        value: boost.id,
                    })) : [];
                await interaction.respond(choices.filter(choice => `${choice.name} ${choice.value}`.toLowerCase().includes(search)).slice(0, 25));
                return;
            }
            if (interaction.commandName === "companion") {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand !== "equip" && subcommand !== "unequip") return;
                const player = await Player.findById(interaction.user.id);
                const choices = (player?.companions ?? []).flatMap(({ key }) => {
                    const companion = getCompanion(key);
                    if (subcommand === "unequip" && !player?.equippedCompanions.includes(key)) return [];
                    if (!companion || !`${companion.name} ${key}`.toLowerCase().includes(search)) return [];
                    return [{ name: companion.name, value: key }];
                }).slice(0, 25);
                await interaction.respond(choices);
                return;
            }
            if (interaction.commandName === "tool") {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand !== "equip" && subcommand !== "unequip") return;
                const owned = await getPlayerItems(interaction.user.id);
                const equipped = subcommand === "unequip"
                    ? (await getPlayerScavengeState(interaction.user.id)).equippedTools
                    : [];
                const choices = owned.flatMap(({ key }) => {
                    const tool = tools[key];
                    if (!tool || (subcommand === "unequip" && !equipped.includes(key))) return [];
                    if (!`${tool.name} ${key}`.toLowerCase().includes(search)) return [];
                    return [{ name: tool.name, value: key }];
                }).slice(0, 25);
                await interaction.respond(choices);
                return;
            }
            if (interaction.commandName === "use") {
                const owned = await getPlayerItems(interaction.user.id);
                const choices = owned.flatMap(({ key }) => {
                    const item = items[key];
                    if (!item?.consumableBonus || !`${item.name} ${key}`.toLowerCase().includes(search)) return [];
                    return [{ name: item.name, value: key }];
                }).slice(0, 25);
                await interaction.respond(choices);
                return;
            }
            if (interaction.commandName === "sell") {
                const owned = await getPlayerItems(interaction.user.id);
                const choices = owned.flatMap(({ key, quantity }) => {
                    const item = items[key];
                    if (!item || item.price <= 0 || !`${item.name} ${key}`.toLowerCase().includes(search)) return [];
                    return [{ name: `${item.name} — ${quantity} owned, $${item.price} each`.slice(0, 100), value: key }];
                }).slice(0, 25);
                await interaction.respond(choices);
                return;
            }
            if (interaction.commandName === "craft") {
                const owned = await getPlayerItems(interaction.user.id);
                const backpackKey = (await getPlayerScavengeState(interaction.user.id)).backpackKey;
                const choices = Object.entries(items).flatMap(([key, item]) => {
                    if (!(item instanceof CraftableItem) || !`${item.name} ${key}`.toLowerCase().includes(search)) return [];
                    const recipe = [...item.recipe].map(([ingredient, quantity]) => {
                        const ingredientKey = Object.entries(items)
                            .find(([, candidate]) => candidate === ingredient)?.[0];
                        const amount = (owned.find(ownedItem => ownedItem.key === ingredientKey)?.quantity ?? 0)
                            + Number(ingredientKey === backpackKey);
                        return `${ingredient.name} ${amount}/${quantity}`;
                    }).join(", ");
                    return [{ name: `${item.name} — ${recipe}`.slice(0, 100), value: key }];
                }).slice(0, 25);
                await interaction.respond(choices);
            }
        } catch (error) {
            console.error("Failed to load autocomplete choices:", error);
            await interaction.respond([]);
        }
    },
};
