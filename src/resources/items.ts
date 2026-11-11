import { Rarity } from "./rarities.js";

export enum ItemCategory {
    Material = "Material",
    Component = "Component",
    Consumable = "Consumable",
    Treasure = "Treasure",
    Tool = "Tool",
    Backpack = "Backpack"
}

export type ToolBonus =
    | { readonly type: "rarityWeightMultiplier"; readonly minimumRarity: Rarity; readonly multiplier: number }
    | { readonly type: "categoryWeightMultiplier"; readonly category: ItemCategory; readonly multiplier: number };

export interface ConsumableBonus {
    readonly type: "scavengeRarity" | "extraFindChance";
    readonly multiplier: number;
    readonly durationMinutes: number;
}

export type Recipe = ReadonlyMap<Item, number>;

const rarityRanks = Object.values(Rarity);
const listedToolBonusMultiplier = 1.5;
const rarityBaseWeights: Readonly<Record<Rarity, number>> = {
    [Rarity.Common]: 100_000_000,
    [Rarity.Uncommon]: 30_000_000,
    [Rarity.Rare]: 9_000_000,
    [Rarity.Epic]: 2_700_000,
    [Rarity.Legendary]: 810_000,
    [Rarity.Mythic]: 243_000,
    [Rarity.Eternal]: 72_900
};

function scaleScavengeWeight(rarity: Rarity, weightSeed: number): number {
    const variation = 0.85 + Math.min(Math.log10(Math.max(1, weightSeed)), 8) * 0.0375;
    return Math.round(rarityBaseWeights[rarity] * variation);
}

export class Item {
    readonly name: string;
    readonly description: string;
    readonly price: number;
    readonly rarity: Rarity;
    readonly category: ItemCategory;
    readonly weight: number;
    readonly canScavenge: boolean;
    readonly toolsWithBonus: Tool[];
    readonly blacklistTools: Tool[];
    consumableBonus?: ConsumableBonus;

    constructor(
        name: string,
        description: string,
        price: number,
        rarity: Rarity,
        category: ItemCategory,
        weight: number,
        canScavenge: boolean,
        toolsWithBonus: Tool[] = [],
        blacklistTools: Tool[] = []
    ) {
        this.name = name;
        this.description = description;
        this.price = price;
        this.rarity = rarity;
        this.category = category;
        this.weight = weight;
        this.canScavenge = canScavenge;
        this.toolsWithBonus = toolsWithBonus;
        this.blacklistTools = blacklistTools;
    }
}

export class CraftableItem extends Item {
    readonly recipe: Recipe;
    readonly canScavenge = false;

    constructor(
        name: string,
        description: string,
        rarity: Rarity,
        category: ItemCategory,
        recipe: Recipe,
        toolsWithBonus: Tool[] = [],
        blacklistTools: Tool[] = []
    ) {
        super(
            name,
            description,
            CraftableItem.calculatePrice(recipe),
            rarity,
            category,
            0,
            false,
            toolsWithBonus,
            blacklistTools
        );
        this.recipe = recipe;
    }

    private static calculatePrice(recipe: Recipe): number {
        let basePrice = 0;
        for (const [item, quantity] of recipe) {
            basePrice += item.price * quantity;
        }
        return Math.floor(basePrice * 1.05);
    }
}

export class Tool extends CraftableItem {
    readonly bonus: ToolBonus;

    constructor(
        name: string,
        description: string,
        rarity: Rarity,
        recipe: Recipe,
        bonus: ToolBonus,
        toolsWithBonus: Tool[] = [],
        blacklistTools: Tool[] = []
    ) {
        super(
            name,
            description,
            rarity,
            ItemCategory.Tool,
            recipe,
            toolsWithBonus,
            blacklistTools
        );
        this.bonus = bonus;
    }
}

export class Backpack extends Item {
    constructor(name: string, description: string, rarity: Rarity, readonly capacity: number) {
        super(name, description, 0, rarity, ItemCategory.Backpack, 0, false);
    }
}

export class BackpackUpgrade extends CraftableItem {
    constructor(
        name: string, description: string, rarity: Rarity, readonly capacity: number,
        readonly previous: Backpack | BackpackUpgrade, ingredients: Recipe,
    ) {
        super(name, description, rarity, ItemCategory.Backpack, new Map([[previous, 1], ...ingredients]));
    }
}

const scavengableItems: Record<string, Item> = {
    wild_berries: new Item(
        "Wild Berries", "A handful of sweet berries growing along well-traveled paths.",
        4, Rarity.Common, ItemCategory.Consumable, scaleScavengeWeight(Rarity.Common, 100_000_000), true
    ),
    fieldstone: new Item(
        "Fieldstone", "A sturdy stone that can be shaped into simple equipment.",
        6, Rarity.Common, ItemCategory.Material, scaleScavengeWeight(Rarity.Common, 90_000_000), true
    ),
    scrap_cloth: new Item(
        "Scrap Cloth", "Useful scraps of fabric recovered from abandoned camps.",
        8, Rarity.Common, ItemCategory.Material, scaleScavengeWeight(Rarity.Common, 75_000_000), true
    ),
    iron_ore: new Item(
        "Iron Ore", "A heavy piece of ore that can be smelted and worked.",
        18, Rarity.Uncommon, ItemCategory.Material, scaleScavengeWeight(Rarity.Uncommon, 38_000_000), true
    ),
    moonleaf: new Item(
        "Moonleaf", "A pale herb that gathers a faint glow after sunset.",
        22, Rarity.Uncommon, ItemCategory.Consumable, scaleScavengeWeight(Rarity.Uncommon, 30_000_000), true
    ),
    amber_shard: new Item(
        "Amber Shard", "A warm-colored fragment preserved in ancient resin.",
        55, Rarity.Rare, ItemCategory.Component, scaleScavengeWeight(Rarity.Rare, 18_000_000), true
    ),
    glass_shard: new Item(
        "Glass Shard", "A sharp, translucent fragment found among old ruins.",
        48, Rarity.Rare, ItemCategory.Component, scaleScavengeWeight(Rarity.Rare, 14_000_000), true,
        [], []
    ),
    silver_ore: new Item(
        "Silver Ore", "A rare vein of silver hidden beneath the surface.",
        110, Rarity.Epic, ItemCategory.Material, scaleScavengeWeight(Rarity.Epic, 6_000_000), true
    ),
    sunstone: new Item(
        "Sunstone", "A brilliant stone that seems to hold the warmth of daylight.",
        260, Rarity.Legendary, ItemCategory.Component, scaleScavengeWeight(Rarity.Legendary, 2_500_000), true
    ),
    echo_crystal: new Item(
        "Echo Crystal", "A resonant crystal that hums when carried near old ruins.",
        620, Rarity.Mythic, ItemCategory.Treasure, scaleScavengeWeight(Rarity.Mythic, 700_000), true
    ),
    starfall_relic: new Item(
        "Starfall Relic", "An almost impossibly rare remnant of a fallen star.",
        2_500, Rarity.Eternal, ItemCategory.Treasure, scaleScavengeWeight(Rarity.Eternal, 2), true
    )
};

type ScavengeItemDefinition = readonly [string, string, string, Rarity, number, number];

function addScavengeItems(category: ItemCategory, definitions: readonly ScavengeItemDefinition[]): void {
    for (const [key, name, description, rarity, price, weight] of definitions) {
        scavengableItems[key] = new Item(
            name, description, price, rarity, category, scaleScavengeWeight(rarity, weight), true
        );
    }
}

addScavengeItems(ItemCategory.Material, [
    ["flint", "Flint", "A sharp-edged stone useful for making primitive tools.", Rarity.Common, 5, 85_000_000],
    ["copper_ore", "Copper Ore", "A reddish chunk of soft copper-bearing rock.", Rarity.Common, 9, 70_000_000],
    ["pine_resin", "Pine Resin", "Sticky resin gathered from old pine trees.", Rarity.Common, 7, 62_000_000],
    ["clay_lump", "Clay Lump", "Fine clay that can be molded and fired.", Rarity.Common, 6, 55_000_000],
    ["bone_fragment", "Bone Fragment", "A tough fragment of bone left behind in the wild.", Rarity.Common, 10, 48_000_000],
    ["coal_chunk", "Coal Chunk", "A small piece of fuel-rich black coal.", Rarity.Uncommon, 14, 32_000_000],
    ["tin_ore", "Tin Ore", "A dull metallic ore used in simple alloys.", Rarity.Uncommon, 17, 26_000_000],
    ["hardwood", "Hardwood", "Dense timber prized for sturdy handles and frames.", Rarity.Uncommon, 20, 22_000_000],
    ["cobalt_ore", "Cobalt Ore", "A deep-blue ore found in rocky outcrops.", Rarity.Uncommon, 38, 15_000_000],
    ["basalt_core", "Basalt Core", "A dense volcanic stone with a glassy sheen.", Rarity.Rare, 52, 12_000_000],
    ["gold_ore", "Gold Ore", "A glittering seam of precious metal in rough stone.", Rarity.Rare, 95, 9_000_000],
    ["meteor_iron", "Meteor Iron", "Unusually dense iron recovered from an impact site.", Rarity.Rare, 140, 7_000_000],
    ["mithril_ore", "Mithril Ore", "A lightweight silver-blue metal found deep underground.", Rarity.Epic, 280, 5_000_000],
    ["froststeel", "Froststeel", "A cold-forged metal that never seems to warm.", Rarity.Epic, 420, 3_500_000],
    ["dragonbone", "Dragonbone", "A nearly indestructible bone from an ancient beast.", Rarity.Legendary, 900, 2_000_000],
    ["void_slag", "Void Slag", "A fragment of matter warped by a distant rift.", Rarity.Mythic, 1_800, 450_000]
]);

addScavengeItems(ItemCategory.Component, [
    ["copper_wire", "Copper Wire", "A coil of flexible wire salvaged from old equipment.", Rarity.Common, 8, 88_000_000],
    ["leather_strip", "Leather Strip", "A durable strip of cured hide.", Rarity.Common, 7, 72_000_000],
    ["wooden_handle", "Wooden Handle", "A smooth handle carved from a sturdy branch.", Rarity.Common, 6, 58_000_000],
    ["linen_roll", "Linen Roll", "A neat roll of strong, tightly woven linen.", Rarity.Uncommon, 15, 42_000_000],
    ["brass_fitting", "Brass Fitting", "A small precision fitting made of polished brass.", Rarity.Uncommon, 19, 34_000_000],
    ["resin_lump", "Resin Lump", "A hardened lump of resin suitable for binding parts.", Rarity.Uncommon, 12, 27_000_000],
    ["gear_set", "Gear Set", "A matched set of small metal gears.", Rarity.Uncommon, 32, 20_000_000],
    ["quartz_lens", "Quartz Lens", "A clear lens cut from a flawless quartz crystal.", Rarity.Rare, 65, 16_000_000],
    ["silver_wire", "Silver Wire", "Fine silver wire prized by skilled crafters.", Rarity.Rare, 90, 12_000_000],
    ["clockwork_spring", "Clockwork Spring", "A tightly wound spring with a precise return.", Rarity.Rare, 78, 10_000_000],
    ["glow_cap", "Glowcap", "A luminous cap used in lanterns and alchemical mixtures.", Rarity.Rare, 82, 8_000_000],
    ["prism_glass", "Prism Glass", "Colored glass that splits light into bright bands.", Rarity.Epic, 190, 6_000_000],
    ["runed_plate", "Runed Plate", "A small metal plate marked with protective runes.", Rarity.Epic, 330, 4_000_000],
    ["storm_thread", "Storm Thread", "A charged filament that crackles when stretched.", Rarity.Legendary, 700, 2_500_000],
    ["phoenix_quill", "Phoenix Quill", "A feather that smolders without burning away.", Rarity.Legendary, 1_100, 1_500_000],
    ["dream_spindle", "Dream Spindle", "A fine spindle said to catch fragments of dreams.", Rarity.Mythic, 2_200, 600_000],
    ["worldglass", "Worldglass", "A translucent shard with a tiny landscape inside.", Rarity.Eternal, 6_000, 6]
]);

addScavengeItems(ItemCategory.Consumable, [
    ["healing_moss", "Healing Moss", "Soft moss with soothing, restorative properties.", Rarity.Common, 5, 82_000_000],
    ["dried_fruit", "Dried Fruit", "A sweet, long-lasting trail snack.", Rarity.Common, 4, 68_000_000],
    ["fresh_mushroom", "Fresh Mushroom", "An edible forest mushroom with an earthy flavor.", Rarity.Common, 5, 56_000_000],
    ["wild_mint", "Wild Mint", "Aromatic leaves that refresh tired travelers.", Rarity.Common, 6, 47_000_000],
    ["river_reed", "River Reed", "A crisp reed with a mild, clean taste.", Rarity.Uncommon, 10, 39_000_000],
    ["bitterroot", "Bitterroot", "A potent root used in traditional tonics.", Rarity.Uncommon, 16, 31_000_000],
    ["sunberry", "Sunberry", "A golden berry that ripens in open meadows.", Rarity.Uncommon, 13, 24_000_000],
    ["pepper_pod", "Pepper Pod", "A fiery pod that warms even the coldest meal.", Rarity.Uncommon, 18, 19_000_000],
    ["blue_mushroom", "Blue Mushroom", "A blue-capped mushroom with a restorative aroma.", Rarity.Rare, 38, 15_000_000],
    ["silver_thyme", "Silver Thyme", "A fragrant herb with silvery leaves.", Rarity.Rare, 46, 11_000_000],
    ["emberroot", "Emberroot", "A warm root that holds heat long after it is picked.", Rarity.Rare, 60, 8_500_000],
    ["frost_plum", "Frost Plum", "A cool, sweet fruit found in high mountain groves.", Rarity.Epic, 125, 6_500_000],
    ["star_anise", "Star Anise", "A rare spice shaped like a tiny many-pointed star.", Rarity.Epic, 180, 4_500_000],
    ["golden_pear", "Golden Pear", "A fragrant fruit with a rich golden skin.", Rarity.Legendary, 360, 2_800_000],
    ["phoenix_pepper", "Phoenix Pepper", "An intensely rare spice that glows like a coal.", Rarity.Legendary, 520, 1_800_000],
    ["moonwater", "Moonwater", "A clear vial of water gathered under a full moon.", Rarity.Mythic, 980, 800_000],
    ["ambrosia_berry", "Ambrosia Berry", "A legendary berry with a taste unlike anything mortal.", Rarity.Mythic, 1_600, 300_000],
    ["eternal_nectar", "Eternal Nectar", "A single drop of nectar that never loses its radiance.", Rarity.Eternal, 8_000, 3]
]);

addScavengeItems(ItemCategory.Treasure, [
    ["old_coin", "Old Coin", "A worn coin bearing the crest of a forgotten ruler.", Rarity.Common, 12, 32_000_000],
    ["brass_button", "Brass Button", "A decorative button from a long-lost uniform.", Rarity.Common, 9, 25_000_000],
    ["sea_glass", "Sea Glass", "A smooth piece of colored glass polished by waves.", Rarity.Uncommon, 18, 18_000_000],
    ["etched_token", "Etched Token", "A small token engraved with an unfamiliar symbol.", Rarity.Uncommon, 28, 14_000_000],
    ["carved_figurine", "Carved Figurine", "A tiny wooden figure from an unknown culture.", Rarity.Uncommon, 35, 10_000_000],
    ["buried_locket", "Buried Locket", "A tarnished locket with a faded portrait inside.", Rarity.Rare, 75, 8_000_000],
    ["sailors_compass", "Sailor's Compass", "A brass compass that points faintly toward the coast.", Rarity.Rare, 110, 6_000_000],
    ["forgotten_medal", "Forgotten Medal", "A medal awarded for an accomplishment no record recalls.", Rarity.Rare, 145, 4_500_000],
    ["royal_seal", "Royal Seal", "A signet seal from a vanished royal house.", Rarity.Epic, 260, 3_500_000],
    ["antique_hourglass", "Antique Hourglass", "An ornate hourglass filled with shimmering sand.", Rarity.Epic, 340, 2_500_000],
    ["serpent_idol", "Serpent Idol", "A jade idol depicting a coiled and watchful serpent.", Rarity.Epic, 480, 1_800_000],
    ["sunken_crown", "Sunken Crown", "A small crown recovered from a shipwreck.", Rarity.Legendary, 950, 1_300_000],
    ["stargazer_map", "Stargazer Map", "An old chart that depicts constellations yet unknown.", Rarity.Legendary, 1_200, 900_000],
    ["singing_goblet", "Singing Goblet", "A silver goblet that rings when starlight touches it.", Rarity.Mythic, 1_900, 550_000],
    ["dragon_egg_fossil", "Dragon Egg Fossil", "A fossilized egg etched with delicate scales.", Rarity.Mythic, 2_800, 260_000],
    ["celestial_dial", "Celestial Dial", "A tiny dial that tracks the motion of distant stars.", Rarity.Mythic, 4_000, 90_000],
    ["crown_of_dawn", "Crown of Dawn", "A radiant circlet said to mark the first sunrise.", Rarity.Eternal, 12_000, 8],
    ["nameless_archive", "Nameless Archive", "A miniature archive containing pages that rewrite themselves.", Rarity.Eternal, 20_000, 1]
]);

addScavengeItems(ItemCategory.Material, [
    ["granite_chip", "Granite Chip", "A clean-cut piece of hard gray granite.", Rarity.Common, 5, 6_000_000],
    ["birch_bark", "Birch Bark", "A flexible sheet of pale bark gathered from fallen trees.", Rarity.Common, 6, 12_000_000],
    ["chalk_stone", "Chalk Stone", "A soft white stone that leaves a bright mark.", Rarity.Common, 5, 20_000_000],
    ["zinc_ore", "Zinc Ore", "A blue-gray ore used in protective alloys.", Rarity.Uncommon, 18, 8_000_000],
    ["peat_brick", "Peat Brick", "Compressed peat that burns slowly and evenly.", Rarity.Uncommon, 13, 16_000_000],
    ["smoky_quartz", "Smoky Quartz", "A dark translucent mineral with smoky bands.", Rarity.Uncommon, 24, 28_000_000],
    ["cinnabar", "Cinnabar", "A vivid red mineral found in warm rocky seams.", Rarity.Rare, 68, 9_000_000],
    ["jade_ore", "Jade Ore", "A green-veined stone hiding a polished gem within.", Rarity.Rare, 95, 24_000_000],
    ["platinum_ore", "Platinum Ore", "A dense silver-white metal from deep deposits.", Rarity.Epic, 310, 10_000_000],
    ["thunderstone", "Thunderstone", "A dark stone that crackles after a storm.", Rarity.Epic, 390, 26_000_000],
    ["adamant_shale", "Adamant Shale", "A layered rock threaded with nearly unbreakable metal.", Rarity.Legendary, 760, 12_000_000],
    ["glacier_iron", "Glacier Iron", "A blue metal preserved in an ancient glacier.", Rarity.Legendary, 1_050, 30_000_000],
    ["riftstone", "Riftstone", "A dense mineral that bends light around its edges.", Rarity.Mythic, 1_900, 14_000_000],
    ["titanium_bloom", "Titanium Bloom", "A flower-shaped deposit of exceptionally light metal.", Rarity.Mythic, 2_500, 35_000_000],
    ["astral_geode", "Astral Geode", "A geode filled with crystals that mirror the night sky.", Rarity.Eternal, 9_000, 18_000_000],
    ["creation_shard", "Creation Shard", "A fragment of matter from before the first stars.", Rarity.Eternal, 15_000, 42_000_000]
]);

addScavengeItems(ItemCategory.Component, [
    ["hemp_cord", "Hemp Cord", "A short length of strong, tightly twisted cord.", Rarity.Common, 5, 7_000_000],
    ["wooden_peg", "Wooden Peg", "A small peg carved to hold simple parts together.", Rarity.Common, 3, 13_000_000],
    ["bone_needle", "Bone Needle", "A smooth needle shaped from a sturdy bone splinter.", Rarity.Common, 8, 22_000_000],
    ["copper_clasp", "Copper Clasp", "A small clasp stamped from bright copper.", Rarity.Uncommon, 14, 9_000_000],
    ["waxed_thread", "Waxed Thread", "Durable thread protected with a thin coat of wax.", Rarity.Uncommon, 12, 17_000_000],
    ["leather_pouch", "Leather Pouch", "A compact pouch with a sturdy drawstring.", Rarity.Uncommon, 20, 32_000_000],
    ["polished_amber", "Polished Amber", "A clear amber bead with a tiny fossil inside.", Rarity.Rare, 62, 11_000_000],
    ["steel_buckle", "Steel Buckle", "A resilient buckle forged from tempered steel.", Rarity.Rare, 76, 25_000_000],
    ["electrum_pin", "Electrum Pin", "A finely worked pin made from a gold-silver alloy.", Rarity.Epic, 210, 8_000_000],
    ["windup_core", "Windup Core", "A precise mechanism that stores energy in a spring.", Rarity.Epic, 285, 23_000_000],
    ["sapphire_bearing", "Sapphire Bearing", "A jewel bearing that turns with almost no friction.", Rarity.Legendary, 620, 12_000_000],
    ["living_fiber", "Living Fiber", "A golden strand that flexes and tightens on its own.", Rarity.Legendary, 840, 29_000_000],
    ["gravity_lens", "Gravity Lens", "A small lens that distorts the space seen through it.", Rarity.Mythic, 1_700, 16_000_000],
    ["astral_chain", "Astral Chain", "A delicate chain forged from light-catching links.", Rarity.Mythic, 2_300, 38_000_000],
    ["genesis_cog", "Genesis Cog", "A perfect gear that turns without friction or wear.", Rarity.Eternal, 8_500, 19_000_000],
    ["reality_thread", "Reality Thread", "A fine filament said to bind distant places together.", Rarity.Eternal, 13_000, 45_000_000]
]);

addScavengeItems(ItemCategory.Consumable, [
    ["sweet_root", "Sweet Root", "A crisp root with a mellow, sugary taste.", Rarity.Common, 4, 8_000_000],
    ["pond_cress", "Pond Cress", "Fresh peppery greens gathered from clear water.", Rarity.Common, 4, 15_000_000],
    ["hazelnut", "Hazelnut", "A rich nut gathered from woodland shrubs.", Rarity.Common, 5, 25_000_000],
    ["juniper_berry", "Juniper Berry", "A tart aromatic berry used in hearty trail meals.", Rarity.Uncommon, 9, 7_000_000],
    ["chamomile", "Chamomile", "A soothing flower gathered in sunny clearings.", Rarity.Uncommon, 12, 18_000_000],
    ["wild_garlic", "Wild Garlic", "A pungent bulb that adds flavor to simple food.", Rarity.Uncommon, 10, 29_000_000],
    ["rainbow_chard", "Rainbow Chard", "Colorful leaves full of crisp, refreshing juice.", Rarity.Rare, 32, 8_000_000],
    ["honeycomb", "Honeycomb", "A small piece of fresh comb filled with wild honey.", Rarity.Rare, 42, 17_000_000],
    ["cinder_truffle", "Cinder Truffle", "A smoky delicacy that grows near warm stone.", Rarity.Rare, 75, 31_000_000],
    ["glacier_berry", "Glacier Berry", "A cool blue berry preserved by mountain frost.", Rarity.Epic, 115, 9_000_000],
    ["dream_melon", "Dream Melon", "A fragrant melon with a softly shimmering rind.", Rarity.Epic, 160, 20_000_000],
    ["saffron_bloom", "Saffron Bloom", "A rare flower whose threads make a prized spice.", Rarity.Epic, 220, 34_000_000],
    ["royal_cacao", "Royal Cacao", "A deep, rich cacao pod from a sheltered grove.", Rarity.Legendary, 390, 13_000_000],
    ["comet_citrus", "Comet Citrus", "A bright fruit streaked with silver-blue veins.", Rarity.Legendary, 570, 33_000_000],
    ["stardust_tea", "Stardust Tea", "A fragrant infusion made from luminous leaves.", Rarity.Mythic, 1_100, 14_000_000],
    ["celestial_fig", "Celestial Fig", "A tender fig said to ripen only beneath meteor showers.", Rarity.Mythic, 1_450, 36_000_000],
    ["first_spring_water", "First Spring Water", "Water drawn from a spring older than recorded time.", Rarity.Eternal, 7_500, 21_000_000],
    ["worldtree_fruit", "Worldtree Fruit", "A fruit carrying the scent of every season at once.", Rarity.Eternal, 11_000, 48_000_000]
]);

addScavengeItems(ItemCategory.Treasure, [
    ["cracked_die", "Cracked Die", "A worn die with unusual symbols in place of numbers.", Rarity.Common, 8, 10_000_000],
    ["copper_thimble", "Copper Thimble", "A small copper thimble etched with a maker's mark.", Rarity.Uncommon, 15, 20_000_000],
    ["glass_bead", "Glass Bead", "A bright bead traded along an old woodland route.", Rarity.Rare, 26, 6_000_000],
    ["pilgrims_charm", "Pilgrim's Charm", "A tiny charm carried on a long-forgotten journey.", Rarity.Rare, 48, 13_000_000],
    ["broken_signet", "Broken Signet", "A cracked signet ring bearing half an unknown crest.", Rarity.Rare, 70, 27_000_000],
    ["bronze_astrolabe", "Bronze Astrolabe", "A pocket-sized instrument for reading the stars.", Rarity.Epic, 190, 8_000_000],
    ["engraved_flute", "Engraved Flute", "A silver-toned flute carved with delicate vines.", Rarity.Epic, 250, 16_000_000],
    ["buried_diadem", "Buried Diadem", "A narrow diadem set with cloudy blue stones.", Rarity.Epic, 390, 30_000_000],
    ["empresses_mirror", "Empress's Mirror", "A hand mirror framed with tiny gold leaves.", Rarity.Legendary, 790, 7_000_000],
    ["stormglass_orb", "Stormglass Orb", "A glass orb that swirls with miniature storm clouds.", Rarity.Legendary, 1_050, 15_000_000],
    ["phoenix_tapestry", "Phoenix Tapestry", "A finely woven tapestry depicting a rising firebird.", Rarity.Legendary, 1_450, 25_000_000],
    ["queens_last_letter", "Queen's Last Letter", "A sealed letter from the final day of a lost kingdom.", Rarity.Legendary, 1_200, 39_000_000],
    ["lunar_orrery", "Lunar Orrery", "A miniature mechanical model of a moonlit sky.", Rarity.Mythic, 1_800, 9_000_000],
    ["oracle_sundial", "Oracle Sundial", "A dark sundial whose shadow points toward hidden paths.", Rarity.Mythic, 2_450, 18_000_000],
    ["tideglass_hour", "Tideglass Hour", "An hourglass that measures the rise and fall of distant tides.", Rarity.Mythic, 3_100, 28_000_000],
    ["memory_casket", "Memory Casket", "A sealed casket that softly repeats forgotten names.", Rarity.Mythic, 3_800, 44_000_000],
    ["first_light_circlet", "First Light Circlet", "A circlet said to have caught the first ray of dawn.", Rarity.Eternal, 14_000, 10_000_000],
    ["infinite_compass", "Infinite Compass", "A compass whose needle points to a place that does not exist.", Rarity.Eternal, 18_000, 22_000_000],
    ["origin_prism", "Origin Prism", "A prism containing the colors of the world's first sunrise.", Rarity.Eternal, 25_000, 34_000_000],
    ["last_page", "The Last Page", "A page that records the ending of every story but its own.", Rarity.Eternal, 30_000, 50_000_000]
]);

const recipes = {
    healing_balm: new Map<Item, number>([
        [scavengableItems.wild_berries, 3],
        [scavengableItems.moonleaf, 1]
    ]),
    amber_lantern: new Map<Item, number>([
        [scavengableItems.fieldstone, 4],
        [scavengableItems.scrap_cloth, 2],
        [scavengableItems.amber_shard, 1]
    ]),
    iron_pick: new Map<Item, number>([
        [scavengableItems.fieldstone, 3],
        [scavengableItems.iron_ore, 4],
        [scavengableItems.scrap_cloth, 1]
    ]),
    moonlit_sieve: new Map<Item, number>([
        [scavengableItems.iron_ore, 3],
        [scavengableItems.moonleaf, 2],
        [scavengableItems.glass_shard, 1]
    ]),
    prospector_compass: new Map<Item, number>([
        [scavengableItems.silver_ore, 2],
        [scavengableItems.sunstone, 1],
        [scavengableItems.echo_crystal, 1]
    ]),
    trail_rations: new Map<Item, number>([
        [scavengableItems.wild_berries, 2],
        [scavengableItems.dried_fruit, 2],
        [scavengableItems.sweet_root, 1]
    ]),
    reinforced_gloves: new Map<Item, number>([
        [scavengableItems.leather_strip, 3],
        [scavengableItems.hemp_cord, 2],
        [scavengableItems.copper_clasp, 1]
    ]),
    starglass_flask: new Map<Item, number>([
        [scavengableItems.prism_glass, 2],
        [scavengableItems.quartz_lens, 1],
        [scavengableItems.silver_wire, 2]
    ]),
    forager_basket: new Map<Item, number>([
        [scavengableItems.leather_pouch, 2],
        [scavengableItems.hardwood, 3],
        [scavengableItems.hemp_cord, 2]
    ]),
    geologists_hammer: new Map<Item, number>([
        [scavengableItems.fieldstone, 3],
        [scavengableItems.iron_ore, 3],
        [scavengableItems.steel_buckle, 1]
    ]),
    relic_locator: new Map<Item, number>([
        [scavengableItems.echo_crystal, 1],
        [scavengableItems.sailors_compass, 1],
        [scavengableItems.gravity_lens, 1]
    ])
};

const craftedItems: Record<string, Item> = {
    healing_balm: new CraftableItem(
        "Healing Balm", "A restorative salve brewed from berries and moonleaf.",
        Rarity.Uncommon, ItemCategory.Consumable, recipes.healing_balm
    ),
    trail_rations: new CraftableItem(
        "Trail Rations", "A filling bundle of berries and dried fruit for long journeys.",
        Rarity.Common, ItemCategory.Consumable, recipes.trail_rations
    ),
    reinforced_gloves: new CraftableItem(
        "Reinforced Gloves", "Hard-wearing gloves that protect hands during difficult searches.",
        Rarity.Rare, ItemCategory.Component, recipes.reinforced_gloves
    ),
    starglass_flask: new CraftableItem(
        "Starglass Flask", "A resilient flask assembled from polished glass and silver wire.",
        Rarity.Epic, ItemCategory.Component, recipes.starglass_flask
    )
};

const smallPouch = new Backpack("Small Pouch", "A simple starter pouch with 10 storage slots.", Rarity.Common, 10);
const shoulderBag = new BackpackUpgrade(
    "Shoulder Bag", "A comfortable shoulder bag with 20 storage slots.", Rarity.Uncommon, 20, smallPouch,
    new Map([[scavengableItems.scrap_cloth, 3], [scavengableItems.leather_strip, 2], [scavengableItems.copper_wire, 2]]),
);
const travelPack = new BackpackUpgrade(
    "Travel Pack", "A sturdy pack with 35 storage slots.", Rarity.Rare, 35, shoulderBag,
    new Map([[scavengableItems.leather_strip, 4], [scavengableItems.linen_roll, 3], [scavengableItems.brass_fitting, 2]]),
);
const explorersBackpack = new BackpackUpgrade(
    "Explorer's Backpack", "A reinforced backpack with 55 storage slots.", Rarity.Epic, 55, travelPack,
    new Map([[scavengableItems.brass_fitting, 3], [scavengableItems.scrap_cloth, 5], [scavengableItems.silver_ore, 2]]),
);
const adventurersRucksack = new BackpackUpgrade(
    "Adventurer's Rucksack", "A spacious rucksack with 80 storage slots.", Rarity.Legendary, 80, explorersBackpack,
    new Map([[scavengableItems.sunstone, 2], [scavengableItems.leather_strip, 8], [scavengableItems.brass_fitting, 4]]),
);
export const backpacks: Record<string, Backpack | BackpackUpgrade> = {
    small_pouch: smallPouch,
    shoulder_bag: shoulderBag,
    travel_pack: travelPack,
    explorers_backpack: explorersBackpack,
    adventurers_rucksack: adventurersRucksack,
};

export const tools: Record<string, Tool> = {
    field_satchel: new Tool(
        "Field Satchel", "A roomy satchel that improves the odds of finding every rarity.",
        Rarity.Uncommon, new Map([
            [scavengableItems.scrap_cloth, 3],
            [scavengableItems.fieldstone, 2]
        ]),
        { type: "rarityWeightMultiplier", minimumRarity: Rarity.Common, multiplier: 1.2 }
    ),
    iron_pick: new Tool(
        "Iron Pick", "A sturdy pick that improves the odds of finding material items.",
        Rarity.Rare, recipes.iron_pick,
        { type: "categoryWeightMultiplier", category: ItemCategory.Material, multiplier: 1.8 }
    ),
    moonlit_sieve: new Tool(
        "Moonlit Sieve", "A fine sieve that helps uncover rarer finds.",
        Rarity.Epic, recipes.moonlit_sieve,
        { type: "rarityWeightMultiplier", minimumRarity: Rarity.Rare, multiplier: 1.6 }
    ),
    prospector_compass: new Tool(
        "Prospector's Compass", "A tuned compass that guides searches toward treasures.",
        Rarity.Legendary, recipes.prospector_compass,
        { type: "categoryWeightMultiplier", category: ItemCategory.Treasure, multiplier: 2.5 }
    ),
    amber_lantern: new Tool(
        "Amber Lantern", "A compact lantern that makes it easier to uncover component items.",
        Rarity.Rare, recipes.amber_lantern,
        { type: "categoryWeightMultiplier", category: ItemCategory.Component, multiplier: 1.5 }
    ),
    forager_basket: new Tool(
        "Forager Basket", "A woven basket that improves the odds of finding consumables.",
        Rarity.Uncommon, recipes.forager_basket,
        { type: "categoryWeightMultiplier", category: ItemCategory.Consumable, multiplier: 1.7 }
    ),
    geologists_hammer: new Tool(
        "Geologist's Hammer", "A balanced hammer that improves the odds of finding materials.",
        Rarity.Epic, recipes.geologists_hammer,
        { type: "categoryWeightMultiplier", category: ItemCategory.Material, multiplier: 1.7 }
    ),
    relic_locator: new Tool(
        "Relic Locator", "A tuned device that guides scavengers toward higher-rarity finds.",
        Rarity.Legendary, recipes.relic_locator,
        { type: "rarityWeightMultiplier", minimumRarity: Rarity.Epic, multiplier: 1.4 }
    )
};

const itemsWithToolBonuses: Record<string, string[]> = {
    iron_ore: ["iron_pick", "field_satchel"],
    moonleaf: ["field_satchel", "moonlit_sieve"],
    amber_shard: ["moonlit_sieve"],
    glass_shard: ["moonlit_sieve"],
    silver_ore: ["iron_pick", "moonlit_sieve"],
    sunstone: ["moonlit_sieve", "prospector_compass"],
    echo_crystal: ["moonlit_sieve", "prospector_compass"],
    starfall_relic: ["prospector_compass"],
    gold_ore: ["geologists_hammer"],
    meteor_iron: ["geologists_hammer"],
    moonwater: ["forager_basket"],
    ambrosia_berry: ["forager_basket"],
    stargazer_map: ["relic_locator"],
    celestial_dial: ["relic_locator"]
};

const itemsBlacklistedFromTools: Record<string, string[]> = {
    wild_berries: ["iron_pick", "moonlit_sieve", "prospector_compass"],
    glass_shard: ["iron_pick"],
    echo_crystal: ["iron_pick"]
};

for (const [itemKey, toolKeys] of Object.entries(itemsWithToolBonuses)) {
    scavengableItems[itemKey].toolsWithBonus.push(...toolKeys.map(key => tools[key]));
}

for (const [itemKey, toolKeys] of Object.entries(itemsBlacklistedFromTools)) {
    scavengableItems[itemKey].blacklistTools.push(...toolKeys.map(key => tools[key]));
}

for (const [key, tool] of Object.entries(tools)) {
    craftedItems[key] = tool;
}

export const items: Record<string, Item> = {
    ...scavengableItems,
    ...craftedItems,
    ...backpacks
};

const consumableBonuses: Record<string, ConsumableBonus> = {
    wild_berries: { type: "scavengeRarity", multiplier: 1.05, durationMinutes: 20 },
    moonleaf: { type: "scavengeRarity", multiplier: 1.2, durationMinutes: 30 },
    healing_moss: { type: "extraFindChance", multiplier: 0.03, durationMinutes: 20 },
    dried_fruit: { type: "extraFindChance", multiplier: 0.04, durationMinutes: 20 },
    fresh_mushroom: { type: "scavengeRarity", multiplier: 1.05, durationMinutes: 20 },
    wild_mint: { type: "scavengeRarity", multiplier: 1.05, durationMinutes: 20 },
    river_reed: { type: "extraFindChance", multiplier: 0.05, durationMinutes: 25 },
    bitterroot: { type: "scavengeRarity", multiplier: 1.1, durationMinutes: 25 },
    sunberry: { type: "extraFindChance", multiplier: 0.05, durationMinutes: 25 },
    pepper_pod: { type: "scavengeRarity", multiplier: 1.1, durationMinutes: 25 },
    blue_mushroom: { type: "scavengeRarity", multiplier: 1.15, durationMinutes: 30 },
    silver_thyme: { type: "extraFindChance", multiplier: 0.07, durationMinutes: 30 },
    emberroot: { type: "scavengeRarity", multiplier: 1.15, durationMinutes: 30 },
    frost_plum: { type: "scavengeRarity", multiplier: 1.2, durationMinutes: 35 },
    star_anise: { type: "extraFindChance", multiplier: 0.1, durationMinutes: 35 },
    golden_pear: { type: "scavengeRarity", multiplier: 1.3, durationMinutes: 40 },
    phoenix_pepper: { type: "extraFindChance", multiplier: 0.15, durationMinutes: 40 },
    trail_rations: { type: "extraFindChance", multiplier: 0.05, durationMinutes: 25 },
    moonwater: { type: "scavengeRarity", multiplier: 1.35, durationMinutes: 45 },
    ambrosia_berry: { type: "extraFindChance", multiplier: 0.2, durationMinutes: 45 },
    sweet_root: { type: "scavengeRarity", multiplier: 1.05, durationMinutes: 20 },
    pond_cress: { type: "extraFindChance", multiplier: 0.03, durationMinutes: 20 },
    hazelnut: { type: "scavengeRarity", multiplier: 1.05, durationMinutes: 20 },
    juniper_berry: { type: "extraFindChance", multiplier: 0.05, durationMinutes: 25 },
    chamomile: { type: "scavengeRarity", multiplier: 1.1, durationMinutes: 25 },
    wild_garlic: { type: "extraFindChance", multiplier: 0.05, durationMinutes: 25 },
    rainbow_chard: { type: "scavengeRarity", multiplier: 1.15, durationMinutes: 30 },
    honeycomb: { type: "extraFindChance", multiplier: 0.07, durationMinutes: 30 },
    cinder_truffle: { type: "scavengeRarity", multiplier: 1.15, durationMinutes: 30 },
    glacier_berry: { type: "scavengeRarity", multiplier: 1.2, durationMinutes: 35 },
    dream_melon: { type: "extraFindChance", multiplier: 0.1, durationMinutes: 35 },
    saffron_bloom: { type: "scavengeRarity", multiplier: 1.2, durationMinutes: 35 },
    royal_cacao: { type: "scavengeRarity", multiplier: 1.3, durationMinutes: 40 },
    comet_citrus: { type: "extraFindChance", multiplier: 0.15, durationMinutes: 40 },
    stardust_tea: { type: "extraFindChance", multiplier: 0.2, durationMinutes: 60 },
    celestial_fig: { type: "scavengeRarity", multiplier: 1.4, durationMinutes: 60 },
    eternal_nectar: { type: "extraFindChance", multiplier: 0.25, durationMinutes: 60 },
    first_spring_water: { type: "scavengeRarity", multiplier: 1.5, durationMinutes: 75 },
    worldtree_fruit: { type: "extraFindChance", multiplier: 0.3, durationMinutes: 75 },
    healing_balm: { type: "scavengeRarity", multiplier: 1.1, durationMinutes: 30 }
};

for (const [key, bonus] of Object.entries(consumableBonuses)) {
    items[key].consumableBonus = bonus;
}

export const itemRarityOrder: readonly Rarity[] = Object.values(Rarity);

export function getScavengeWeight(item: Item, tool?: Tool | readonly Tool[]): number {
    const activeTools = tool ? Array.isArray(tool) ? tool : [tool] : [];
    if (!item.canScavenge || activeTools.some(activeTool => item.blacklistTools.includes(activeTool))) return 0;

    let weight = item.weight;
    for (const activeTool of activeTools) {
        if (item.toolsWithBonus.includes(activeTool)) weight *= listedToolBonusMultiplier;
        if (activeTool.bonus.type === "categoryWeightMultiplier" && item.category === activeTool.bonus.category) {
            weight *= activeTool.bonus.multiplier;
        } else if (activeTool.bonus.type === "rarityWeightMultiplier"
            && rarityRanks.indexOf(item.rarity) >= rarityRanks.indexOf(activeTool.bonus.minimumRarity)) {
            weight *= activeTool.bonus.multiplier;
        }
    }

    return weight;
}
