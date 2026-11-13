import { json, Router } from "express";
import { loadSession } from "../../auth.js";
import Player from "../../classes/Player.js";
import { calculateScavengeWeights, getItemCirculation, getPlayerItemProfile, scavengeOdds, sellPlayerItem } from "../../itemStorage.js";
import { Backpack, BackpackUpgrade, CraftableItem, describeToolBonus, items, ItemCategory, Tool, type Item } from "../../resources/items.js";
import { getLootboxInventory } from "../../lootboxStorage.js";

const router = Router();
const itemKeys = new Map(Object.entries(items).map(([key, item]) => [item, key]));

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
            ? [...item.recipe].map(([ingredient, quantity]) => {
                const ingredientKey = itemKeys.get(ingredient);
                if (!ingredientKey) throw new Error(`Crafting ingredient ${ingredient.name} is missing from the item catalog`);
                return { key: ingredientKey, name: ingredient.name, quantity };
            })
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

router.post("/sell", async (request, response, next) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) {
        response.status(401).json({ error: "Login required" });
        return;
    }
    if (!request.is("application/json")) {
        response.status(415).json({ error: "Content-Type must be application/json" });
        return;
    }
    response.locals.userId = user.id;
    next();
}, json({ limit: "4kb" }), async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const { item, quantity } = request.body ?? {};
    if (typeof item !== "string" || !Number.isSafeInteger(quantity) || quantity < 1) {
        response.status(400).json({ error: "Choose an item and a positive whole-number quantity." });
        return;
    }
    const result = await sellPlayerItem(response.locals.userId, item, quantity);
    if (result.status === "invalid") {
        response.status(400).json({ error: "That item cannot be sold." });
    } else if (result.status === "unowned") {
        response.status(409).json({ error: `You only own ${result.owned} of that item.`, owned: result.owned });
    } else {
        response.json({ item: result.item.name, quantity: result.amount, proceeds: result.proceeds, unequipped: result.unequipped });
    }
});

router.get("/:key", async (request, response) => {
    const circulation = await getItemCirculation();
    const item = serializeItem(request.params.key, circulation, itemOdds(circulation));
    if (!item) {
        response.status(404).json({ error: "Item not found" });
        return;
    }
    response.setHeader("Cache-Control", "no-store");
    const ingredient = items[request.params.key];
    const usedIn = Object.entries(items).flatMap(([key, candidate]) => {
        if (!(candidate instanceof CraftableItem)) return [];
        const quantity = candidate.recipe.get(ingredient);
        return quantity === undefined ? [] : [{ key, name: candidate.name, quantity }];
    }).sort((a, b) => a.name.localeCompare(b.name));
    response.json({ ...item, usedIn });
});

export default router;
