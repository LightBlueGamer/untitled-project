import { Rarity } from "./rarities.js";
import type { Companion, CompanionBonus } from "./companions.js";

type Specialty = "xp" | "xpFlat" | "money" | "moneyFlat" | "finder" | "points" | "casino";
type Creature = readonly [name: string, story: string, specialty: Specialty];

const creatures: Readonly<Record<Rarity, readonly Creature[]>> = {
    [Rarity.Common]: [
        ["Thistlekit", "A fluffy kitten that collects thistledown.", "xp"],
        ["Puddlefin", "A cheerful fish that splashes through puddles.", "moneyFlat"],
        ["Acornip", "A tiny squirrel that guards a single acorn.", "money"],
        ["Breezebug", "A leaf-winged beetle carried by gentle winds.", "xpFlat"],
        ["Cloverhop", "A lucky hopper hiding among clover leaves.", "finder"],
        ["Mudpip", "A muddy duckling that loves rainy afternoons.", "xp"],
        ["Tumbletuft", "A round fluffball that rolls down grassy hills.", "moneyFlat"],
        ["Shellbit", "A shy snail with a polished pebble shell.", "money"],
        ["Daisydot", "A flower-spotted ladybird with a sunny disposition.", "xpFlat"],
        ["Reedwhisk", "A nimble mouse that nests beside quiet streams.", "finder"],
        ["Fuzzlet", "A sleepy caterpillar wrapped in soft fuzz.", "xp"],
        ["Pinepuff", "A pinecone creature with a surprisingly bushy tail.", "moneyFlat"],
        ["Nibbloom", "A curious rabbit that tends wildflowers.", "money"],
        ["Drizzletoad", "A little toad that sings before the rain.", "xpFlat"],
        ["Sootsqueak", "A soot-dusted mouse that explores old hearths.", "finder"],
        ["Bramblebee", "A busy bee that carries berries instead of pollen.", "xp"],
        ["Spriggle", "A walking twig that mimics swaying branches.", "moneyFlat"],
        ["Lichenling", "A gentle pebble creature wearing a lichen cloak.", "money"],
        ["Rippletail", "A playful tadpole that races its own ripples.", "xpFlat"],
        ["Snugglemole", "A burrowing mole that hoards warm blankets.", "finder"],
        ["Pennybadger", "A careful badger that keeps a lucky coin tucked in its den.", "casino"],
    ],
    [Rarity.Uncommon]: [
        ["Coppercurl", "A coiled lizard that polishes forgotten coins.", "money"],
        ["Lanternmidge", "A glowing midge that lights forgotten paths.", "finder"],
        ["Fernfawn", "A woodland fawn with fern-shaped antlers.", "xp"],
        ["Cindermink", "A quick mink with warm ember markings.", "moneyFlat"],
        ["Brookstride", "A long-legged bird that skims mountain brooks.", "xpFlat"],
        ["Marbleback", "A tortoise whose shell resembles veined stone.", "money"],
        ["Honeyquill", "A hedgehog that gathers honey on golden spines.", "moneyFlat"],
        ["Whisperwing", "A quiet owl whose feathers muffle every flight.", "xp"],
        ["Glintscale", "A river lizard with bright reflective scales.", "finder"],
        ["Duskmoth", "A velvety moth drawn to the last light of day.", "xpFlat"],
        ["Nectaroo", "A nectar-loving jumper with an enormous pouch.", "money"],
        ["Cloudskip", "A springy hare that leaps through low clouds.", "xp"],
        ["Flintfox", "A sharp-eyed fox that sparks stones together.", "moneyFlat"],
        ["Tidepincer", "A little crab that follows the changing tide.", "finder"],
        ["Willowisp", "A drifting light that dances between willow branches.", "xpFlat"],
        ["Crestbeak", "A proud bird with a colorful feathered crest.", "money"],
        ["Cobaltusk", "A stout boar with deep blue tusks.", "moneyFlat"],
        ["Petaldrift", "A floating blossom that wanders with the breeze.", "xp"],
        ["Runnelotter", "An energetic otter that knows every stream.", "finder"],
        ["Saffronnewt", "A golden newt that basks on warm stones.", "xpFlat"],
        ["Copperscale", "A bright-scaled lizard that spots favorable wagers.", "casino"],
    ],
    [Rarity.Rare]: [
        ["Moonglade", "A silver stag that appears in moonlit clearings.", "xp"],
        ["Emberquill", "A fire-plumed bird that writes trails in the sky.", "xpFlat"],
        ["Opalorca", "A luminous swimmer with a shell of shifting colors.", "money"],
        ["Vaultweasel", "A clever weasel with a talent for finding hidden caches.", "moneyFlat"],
        ["Mistmantle", "A veiled feline that follows secret mountain trails.", "finder"],
        ["Stormpetrel", "A sea bird that rides the edge of thunderstorms.", "xp"],
        ["Crysturtle", "A patient turtle with translucent crystal armor.", "moneyFlat"],
        ["Rimehare", "A swift hare leaving frost along its tracks.", "xpFlat"],
        ["Sundapple", "A spotted lynx that sleeps in golden sunbeams.", "money"],
        ["Hollowhorn", "A forest guardian whose antlers echo in the wind.", "finder"],
        ["Coralwyrm", "A reef-dwelling serpent decorated with living coral.", "xp"],
        ["Gloamraven", "A raven that remembers every twilight journey.", "xpFlat"],
        ["Jadekoi", "A graceful koi with scales of polished jade.", "money"],
        ["Mothscribe", "A moth that traces letters with shimmering dust.", "xpFlat"],
        ["Dunescout", "A desert fox that navigates shifting dunes.", "finder"],
        ["Bellstag", "A gentle stag whose antlers chime like bells.", "xp"],
        ["Violetide", "A violet ray that glides through deep waters.", "moneyFlat"],
        ["Silverstoat", "A silver-furred hunter with a keen eye for treasure.", "money"],
        ["Glacierpup", "A playful pup born beneath a glacier.", "xpFlat"],
        ["Thornoracle", "A watchful creature nesting in ancient brambles.", "finder"],
        ["Fatefeather", "A raven whose carefully chosen flights seem to turn the odds.", "casino"],
    ],
    [Rarity.Epic]: [
        ["Runeforge", "A small golem carved with moving runes.", "points"],
        ["Thunderlynx", "A lynx that races lightning across the plains.", "xp"],
        ["Aetherhare", "A hare that hops between threads of mist.", "finder"],
        ["Gildedgriff", "A young griffin that guards a glittering hoard.", "money"],
        ["Starbadger", "A burrower whose stripes resemble constellations.", "xpFlat"],
        ["Obsidianox", "A sturdy ox with armor like black glass.", "moneyFlat"],
        ["Velvetwyrm", "A soft-scaled serpent with a hypnotic gaze.", "xp"],
        ["Crownheron", "A regal heron that walks above still water.", "money"],
        ["Fablefox", "A storyteller fox carrying a library of tales.", "points"],
        ["Hailfalcon", "A falcon that dives through hail without slowing.", "xpFlat"],
        ["Briarwarden", "A thorn-armored guardian of overgrown ruins.", "finder"],
        ["Magmahorn", "A horned beast with a glowing volcanic mane.", "moneyFlat"],
        ["Luminseal", "A radiant seal that lights the ocean depths.", "xp"],
        ["Quicksilver", "A liquid-metal creature that slips through cracks.", "money"],
        ["Wispweaver", "A spider that spins luminous threads between stars.", "finder"],
        ["Ancientantler", "An old forest spirit crowned with mossy antlers.", "points"],
        ["Tempestfin", "A sky-swimming fish surrounded by tiny storms.", "xpFlat"],
        ["Sunstonecub", "A bear cub with a warm gemstone heart.", "moneyFlat"],
        ["Nightbloom", "A rare flower beast that wakes beneath the moon.", "xp"],
        ["Echoibis", "A long-beaked wanderer whose calls reveal hidden paths.", "finder"],
        ["Vaultstag", "A regal stag that guards its herd's winnings.", "casino"],
    ],
    [Rarity.Legendary]: [
        ["Dawnphoenix", "A dawn-lit phoenix that rekindles fading hope.", "xp"],
        ["Goldentitan", "A towering guardian with a heart of molten gold.", "money"],
        ["Runesphinx", "A sphinx that teaches riddles to patient travelers.", "points"],
        ["Stormleviathan", "A great serpent that swims through storm clouds.", "finder"],
        ["Mooncarver", "A pale beast whose claws shape silver moonstones.", "moneyFlat"],
        ["Embercrown", "A crowned lion wrapped in an eternal ember mane.", "xpFlat"],
        ["Starforger", "A celestial smith that hammers sparks into stars.", "xp"],
        ["Jewelbasilisk", "A jeweled guardian with a gaze that finds treasure.", "money"],
        ["Voidranger", "A shadowy scout that maps the spaces between worlds.", "finder"],
        ["Elderquill", "An ancient scholar bird carrying a thousand stories.", "points"],
        ["Sunspire", "A golden-winged creature nesting atop the highest peaks.", "xpFlat"],
        ["Tidecolossus", "A gentle giant that carries reefs across the sea.", "moneyFlat"],
        ["Frostregent", "A crystal monarch that rules a silent winter court.", "xp"],
        ["Duskpaladin", "An armored guardian that watches over twilight roads.", "money"],
        ["Horizonhart", "A radiant stag that follows the edge of the horizon.", "finder"],
        ["Lorekeeper", "A wise creature that remembers forgotten civilizations.", "points"],
        ["Ashenwing", "A vast bird reborn from the ashes of old forests.", "xpFlat"],
        ["Pearlkraken", "A many-armed guardian of a luminous pearl vault.", "moneyFlat"],
        ["Cometmane", "A swift lion trailing a comet's brilliant tail.", "xp"],
        ["Viridianwyrm", "A verdant dragon that shelters hidden groves.", "finder"],
        ["Luckwyrm", "A sky serpent that curls around a winning streak.", "casino"],
    ],
    [Rarity.Mythic]: [
        ["Astralwhale", "A whale that sings between distant constellations.", "xp"],
        ["Infinityowl", "An owl that studies every possible tomorrow.", "points"],
        ["Nebulacat", "A feline woven from drifting clouds of stardust.", "finder"],
        ["Gildedmoon", "A lunar spirit that carries ancient celestial treasure.", "money"],
        ["Dreamweaver", "A luminous spinner that stitches dreams into stories.", "xpFlat"],
        ["Worldshell", "A colossal tortoise bearing a miniature floating island.", "moneyFlat"],
        ["Solarseraph", "A many-winged guardian born in the heart of a sun.", "xp"],
        ["Riftseeker", "A nimble explorer that finds doors between realities.", "finder"],
        ["Everrune", "A living inscription that preserves lost knowledge.", "points"],
        ["Prismstag", "A many-colored stag whose antlers refract starlight.", "money"],
        ["Celestialmanta", "A manta gliding across a sea of nebulae.", "xpFlat"],
        ["Vaultdragon", "A dragon entrusted with the treasures of lost kingdoms.", "moneyFlat"],
        ["Twilightkirin", "A twilight guardian surrounded by violet flame.", "xp"],
        ["Fatespinner", "A quiet creature tracing the threads of chance.", "finder"],
        ["Arcanepillar", "A floating stone keeper engraved with ancient lessons.", "points"],
        ["Auricchimera", "A golden chimera with three watchful faces.", "money"],
        ["Mirrormoth", "A moth whose wings reflect forgotten memories.", "xpFlat"],
        ["Deepstar", "A star-shaped voyager from the deepest cosmic sea.", "moneyFlat"],
        ["Equinoxwolf", "A wolf that appears when day and night balance.", "xp"],
        ["Veilstrider", "A long-legged wanderer passing through hidden veils.", "finder"],
        ["Fortunox", "An ancient ox whose measured steps bring luck to high-stakes tables.", "casino"],
    ],
    [Rarity.Eternal]: [
        ["Aeonwarden", "An ageless sentinel guarding the first sunrise.", "points"],
        ["Originwyrm", "A primordial dragon carrying the spark of creation.", "xp"],
        ["Endlessvoyager", "A traveler that has walked every possible road.", "finder"],
        ["Eternaltreasury", "A living vault filled with treasures beyond time.", "money"],
        ["Firstlight", "A radiant creature born before the earliest stars.", "xpFlat"],
        ["Cosmicmonarch", "A crowned giant whose footsteps scatter galaxies.", "moneyFlat"],
        ["Timelessscribe", "A keeper recording stories that never end.", "points"],
        ["Starseam", "A creature that stitches constellations into the night.", "xp"],
        ["Beyondwalker", "A silent wanderer seeking paths outside the universe.", "finder"],
        ["Gildedinfinity", "An endless golden serpent coiled around a hidden vault.", "money"],
        ["Primalchorus", "A many-voiced spirit singing the first song.", "xpFlat"],
        ["Nebulathrone", "A celestial guardian seated among swirling nebulae.", "moneyFlat"],
        ["Allknowing", "A patient sage who has witnessed every age.", "points"],
        ["Eversun", "A brilliant phoenix whose light never fades.", "xp"],
        ["Wovenfate", "A shimmering being that watches countless futures.", "finder"],
        ["Radiantarchive", "A luminous keeper of invaluable ancient relics.", "money"],
        ["Dawnofages", "A gentle herald of every new beginning.", "xpFlat"],
        ["Worldshaper", "A giant artisan molding worlds from stardust.", "moneyFlat"],
        ["Chronosage", "An ageless tutor who shares lessons across time.", "points"],
        ["Omnistar", "A bright wanderer carrying a universe of tiny stars.", "xp"],
        ["Jackpotitan", "A legendary titan whose presence brightens every house-game payout.", "casino"],
    ],
};

const tiers: Readonly<Record<Rarity, { level: number; weight: number }>> = {
    [Rarity.Common]: { level: 0, weight: 5_000_000 },
    [Rarity.Uncommon]: { level: 1, weight: 2_000_000 },
    [Rarity.Rare]: { level: 2, weight: 1_000_000 },
    [Rarity.Epic]: { level: 3, weight: 300_000 },
    [Rarity.Legendary]: { level: 4, weight: 100_000 },
    [Rarity.Mythic]: { level: 5, weight: 15_000 },
    [Rarity.Eternal]: { level: 6, weight: 100 },
};

function specialtyBonus(specialty: Specialty, level: number): { bonus: CompanionBonus; text: string } {
    switch (specialty) {
        case "xp": {
            const percent = 3 + level * 2;
            return { bonus: { type: "experienceMultiplier", multiplier: 1 + percent / 100 }, text: `Grants ${percent}% more XP.` };
        }
        case "xpFlat": {
            const amount = 2 + level * 3;
            return { bonus: { type: "experienceFlat", amount }, text: `Adds ${amount} XP to rewards.` };
        }
        case "money": {
            const percent = 3 + level * 3;
            return { bonus: { type: "balanceMultiplier", multiplier: 1 + percent / 100 }, text: `Grants ${percent}% more money.` };
        }
        case "moneyFlat": {
            const amount = 5 + level * 7;
            return { bonus: { type: "balanceFlat", amount }, text: `Adds $${amount} to money rewards.` };
        }
        case "finder": {
            const percent = 5 + level * 5;
            return { bonus: { type: "rareEncounterWeightMultiplier", multiplier: 1 + percent / 100 }, text: `Multiplies Rare-or-higher encounter weights by ${1 + percent / 100}.` };
        }
        case "points":
            return { bonus: { type: "skillPointsFlat", amount: 1 }, text: "Grants one extra skill point per level." };
        case "casino": {
            const percent = 2 + level;
            return {
                bonus: { type: "casinoPayoutMultiplier", multiplier: 1 + percent / 100 },
                text: `Increases payouts in house casino games by ${percent}%.`,
            };
        }
    }
}

export function createAdditionalCompanions(): Record<string, Companion> {
    const result: Record<string, Companion> = {};
    for (const rarity of Object.values(Rarity)) {
        const { level, weight } = tiers[rarity];
        creatures[rarity].forEach(([name, story, specialty], index) => {
            const key = name.toLowerCase();
            if (Object.hasOwn(result, key)) throw new Error(`Duplicate companion key: ${key}`);
            const { bonus, text } = specialtyBonus(specialty, level);
            result[key] = {
                name,
                description: `${story} ${text}`,
                rarity,
                chanceWeight: Math.max(1, Math.floor(weight * (20 - index) / 20)),
                stats: {
                    HP: 38 + level * 10 + (index * 7) % 25,
                    DMG: 12 + level * 7 + (index * 5) % 17,
                    DEF: 10 + level * 6 + (index * 3) % 18,
                    SPD: 14 + level * 5 + (index * 11) % 22,
                    CRIT: 3 + level * 2 + index % 5,
                },
                bonus,
            };
        });
    }
    return result;
}
