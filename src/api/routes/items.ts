import { Router } from "express";
import Player from "../../classes/Player.js";
import { calculateScavengeWeights, getItemCirculation, getPlayerItemProfile, scavengeOdds } from "../../itemStorage.js";
import { Backpack, BackpackUpgrade, CraftableItem, items, ItemCategory, Tool, type Item } from "../../resources/items.js";
import { getLootboxInventory } from "../../lootboxStorage.js";

const router = Router();

function describeToolBonus(tool: Tool): string {
    const bonus = tool.bonus;
    if (bonus.type === "categoryWeightMultiplier") {
        return `${bonus.multiplier}× chance weight for ${bonus.category} items`;
    }
    return `${bonus.multiplier}× chance weight for ${bonus.minimumRarity} and higher items`;
}

function describeConsumableBonus(item: Item): string | null {
    const bonus = item.consumableBonus;
    if (!bonus) return null;

    switch (bonus.type) {
        case "scavengeRarity":
            return `Increases Rare-or-better item weights by ${bonus.multiplier}×`;
        case "extraFindChance":
            return `Adds a ${Math.round(bonus.multiplier * 100)}% chance to find an extra item`;
    }
    throw new Error(`Unsupported consumable bonus: ${bonus.type}`);
}

function itemOdds(circulation: ReadonlyMap<string, string>): Map<string, number | null> {
    const candidates = Object.entries(items).filter(([, item]) => item.canScavenge)
        .map(([key, item]) => ({ key, item }));
    const counts = new Map([...circulation].map(([key, quantity]) => [key, Number(quantity)]));
    const weights = calculateScavengeWeights(candidates, counts, [], new Player("Baseline", ""), []);
    const odds = scavengeOdds(weights);
    return new Map(candidates.map(({ key }, index) => [key, odds[index]]));
}

function serializeItem(key: string, circulation: ReadonlyMap<string, string>, odds: ReadonlyMap<string, number | null>) {
    const item = items[key];
    if (!item) return null;
    const consumableEffect = describeConsumableBonus(item);
    const consumableBonus = item.consumableBonus;

    return {
        key,
        name: item.name,
        description: consumableEffect && consumableBonus
            ? `${item.description} Bonus effect: ${consumableEffect} for ${consumableBonus.durationMinutes} minutes.`
            : item.description,
        rarity: item.rarity,
        category: item.category,
        price: item.price,
        odds: odds.get(key) ?? null,
        circulation: circulation.get(key) ?? "0",
        canScavenge: item.canScavenge,
        source: item instanceof Backpack ? "Starter" : item.canScavenge ? "Scavengable" : "Crafted",
        capacity: item instanceof Backpack || item instanceof BackpackUpgrade ? item.capacity : null,
        recipe: item instanceof CraftableItem
            ? [...item.recipe].map(([ingredient, quantity]) => ({
                name: ingredient.name,
                quantity,
            }))
            : [],
        toolsWithBonus: item.toolsWithBonus.map(tool => tool.name),
        blacklistTools: item.blacklistTools.map(tool => tool.name),
        toolBonus: item instanceof Tool ? describeToolBonus(item) : null,
        consumableBonus: item.consumableBonus ?? null,
        consumableEffect: consumableEffect && consumableBonus
            ? `${consumableEffect} for ${consumableBonus.durationMinutes} minutes.`
            : null,
    };
}

router.get("/", async (_request, response) => {
    const circulation = await getItemCirculation();
    const odds = itemOdds(circulation);
    response.setHeader("Cache-Control", "no-store");
    response.json({
        categories: Object.values(ItemCategory),
        items: Object.keys(items).map(key => serializeItem(key, circulation, odds)),
    });
});

router.get("/player/:id", async (request, response) => {
    const player = await Player.findById(request.params.id);
    if (!player) {
        response.status(404).json({ error: "Player not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    const lootboxInventory = await getLootboxInventory(request.params.id);
    response.json({
        ...await getPlayerItemProfile(request.params.id, player.toolSlots),
        lootboxes: { boxes: lootboxInventory.boxes.length, boosts: lootboxInventory.boosts.length },
        toolSlots: player.toolSlots,
    });
});

router.get("/:key", async (request, response) => {
    const circulation = await getItemCirculation();
    const item = serializeItem(request.params.key, circulation, itemOdds(circulation));
    if (!item) {
        response.status(404).json({ error: "Item not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json(item);
});

export default router;
