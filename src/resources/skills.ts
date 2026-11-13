interface SkillDefinition {
    id: number;
    name: string;
    description: string;
    prerequisites: readonly Skill[];
    effect: SkillEffect;
    cost: number;
}

export interface AmountSkill extends SkillDefinition {
    operation: EffectOperation.Add | EffectOperation.Multiply;
    skill: (amount: number) => number;
}

export interface MessageSkill extends SkillDefinition {
    operation: EffectOperation.Message;
    messageReward: (context: MessageSkillContext) => MessageSkillReward | null;
}

export type Skill = AmountSkill | MessageSkill;

export interface MessageSkillContext {
    baseExperience: number;
    baseBalance: number;
    regularExperience: number;
    level: number;
    xpRequiredForNextLevel: number;
    balance: number;
    roll: () => number;
}

export interface MessageSkillReward {
    experience?: number;
    balance?: number;
    skillPoints?: number;
    announce?: boolean;
}

export enum SkillEffect {
    Experience = "experience",
    Balance = "balance",
    Skill = "skill",
    CompanionSpawn = "companionSpawn",
    CompanionRarity = "companionRarity",
    Casino = "casino",
    Scavenge = "scavenge",
    ScavengeCooldown = "scavengeCooldown",
    ScavengeRarity = "scavengeRarity",
    ScavengeFind = "scavengeFind",
    ScavengeExperience = "scavengeExperience",
    ToolSlots = "toolSlots",
    LootboxDrop = "lootboxDrop",
    LootboxRarity = "lootboxRarity",
    LootboxReward = "lootboxReward",
    LootboxFind = "lootboxFind",
}

export enum EffectOperation {
    Add = "add",
    Multiply = "multiply",
    Message = "message"
}

// Experience related skills

const experience_gain_1: Skill = {
    id: 1,
    name: "Experience Gain I",
    description: "Gives a bonus 10 experience every time you gain experience",
    prerequisites: [],
    cost: 1,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 10;
    }
};

const experience_gain_2: Skill = {
    id: 2,
    name: "Experience Gain II",
    description: "Gives another bonus 15 experience every time you gain experience",
    prerequisites: [experience_gain_1],
    cost: 2,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 15;
    }
};

const experience_multiplier_1: Skill = {
    id: 3,
    name: "Experience Multiplier I",
    description: "Increases experience points gained (1.25x)",
    prerequisites: [experience_gain_1],
    cost: 2,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.25;
    }
};

const experience_multiplier_2: Skill = {
    id: 4,
    name: "Experience Multiplier II",
    description: "Further Increases experience points gained (1.5x)",
    prerequisites: [experience_multiplier_1],
    cost: 4,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.5;
    }
};

// Money related skills

const extra_income: Skill = {
    id: 5,
    name: "Extra Income",
    description: "Gives a bonus $25 every time you earn money",
    prerequisites: [],
    cost: 1,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 25;
    }
};

const extra_income_2: Skill = {
    id: 6,
    name: "Extra Income II",
    description: "Gives another bonus $50 every time you earn money",
    prerequisites: [extra_income],
    cost: 2,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 50;
    }
};

const money_multiplier_1: Skill = {
    id: 7,
    name: "Money Multiplier I",
    description: "Increases money gained (1.25x)",
    prerequisites: [extra_income],
    cost: 2,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.25;
    }
};

const money_multiplier_2: Skill = {
    id: 8,
    name: "Money Multiplier II",
    description: "Further increases money gained (1.5x)",
    prerequisites: [money_multiplier_1],
    cost: 4,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.5;
    }
};

// Skill related skills

const skill_mastery_1: Skill = {
    id: 9,
    name: "Skill Mastery I",
    description: "Increases amount of skill points gained by 1",
    prerequisites: [],
    cost: 5,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 1;
    }
};

const skill_gain_1: Skill = {
    id: 10,
    name: "Skill Gain I",
    description: "Increases skill points gained (1.5x)",
    prerequisites: [skill_mastery_1],
    cost: 8,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.5;
    }
};

// Message bonuses are added after the ordinary skill-modified reward.
const jackpot: Skill = {
    id: 11,
    name: "Jackpot",
    description: "Each rewarded message grants $25 extra, with a 1 in 10,000 chance to also earn an extra 100x its base money reward. The bot announces a win.",
    prerequisites: [money_multiplier_2],
    cost: 5,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Message,
    messageReward: ({ baseBalance, roll }) => roll() < 1 / 10000
        ? { balance: 25 + baseBalance * 100, announce: true }
        : { balance: 25 },
};

const lucky_find: Skill = {
    id: 12,
    name: "Lucky Find",
    description: "On each rewarded message, a 1 in 20 chance to find an extra 2x its base money reward.",
    prerequisites: [extra_income_2],
    cost: 2,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Message,
    messageReward: ({ baseBalance, roll }) => roll() < 1 / 20
        ? { balance: baseBalance * 2 }
        : null,
};

const compound_interest: Skill = {
    id: 13,
    name: "Compound Interest",
    description: "On each rewarded message, a 1 in 25 chance to earn 1% of your money before the reward.",
    prerequisites: [lucky_find],
    cost: 3,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Message,
    messageReward: ({ balance, roll }) => roll() < 1 / 25
        ? { balance: Math.floor(balance * 0.01) }
        : null,
};

const inspiration: Skill = {
    id: 14,
    name: "Inspiration",
    description: "On each rewarded message, a 1 in 15 chance to gain an extra 3x its base experience reward.",
    prerequisites: [experience_gain_2],
    cost: 2,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Message,
    messageReward: ({ baseExperience, roll }) => roll() < 1 / 15
        ? { experience: baseExperience * 3 }
        : null,
};

const momentumWeights = Array.from({ length: 100 }, (_, index) => 1 / (index + 1) ** 2);
const momentumTotalWeight = momentumWeights.reduce((total, weight) => total + weight, 0);

const momentum: Skill = {
    id: 15,
    name: "Momentum",
    description: "On each rewarded message, a 1 in 1,000 chance to gain 1% to 100% of the XP required for your next level, rounded down. Lower percentages are more likely.",
    prerequisites: [experience_multiplier_2],
    cost: 3,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Message,
    messageReward: ({ xpRequiredForNextLevel, roll }) => {
        const chance = roll();
        if (chance >= 1 / 1000) return null;
        let remaining = chance * 1000 * momentumTotalWeight;
        for (let index = 0; index < momentumWeights.length - 1; index++) {
            remaining -= momentumWeights[index];
            if (remaining < 0) return { experience: Math.floor(xpRequiredForNextLevel * (index + 1) / 100) };
        }
        return { experience: xpRequiredForNextLevel };
    },
};

const discovery: Skill = {
    id: 16,
    name: "Discovery",
    description: "On each rewarded message, a 1 in 2000 chance to discover an extra skill point. The bot announces it.",
    prerequisites: [skill_gain_1],
    cost: 3,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Message,
    messageReward: ({ roll }) => roll() < 1 / 2000
        ? { skillPoints: 1, announce: true }
        : null,
};

const scholars_fortune: Skill = {
    id: 17,
    name: "Scholar's Fortune",
    description: "Each rewarded message grants extra money equal to its base experience roll and extra XP equal to half its base money roll, rounded down.",
    prerequisites: [experience_gain_2, extra_income_2],
    cost: 3,
    effect: SkillEffect.Experience,
    operation: EffectOperation.Message,
    messageReward: ({ baseExperience, baseBalance }) => ({
        balance: baseExperience,
        experience: Math.floor(baseBalance / 2),
    }),
};

const insightful_discovery: Skill = {
    id: 18,
    name: "Insightful Discovery",
    description: "Each rewarded message grants 20% extra XP based on its regular XP reward after additive and multiplier skills, with a 1 in 500 chance to discover an extra skill point. The bot announces discoveries.",
    prerequisites: [inspiration, skill_gain_1],
    cost: 4,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Message,
    messageReward: ({ regularExperience, roll }) => roll() < 1 / 500
        ? { experience: regularExperience * 0.2, skillPoints: 1, announce: true }
        : { experience: regularExperience * 0.2 },
};

const golden_breakthrough: Skill = {
    id: 19,
    name: "Golden Breakthrough",
    description: "On each rewarded message, a 1 in 20 chance to gain an extra 2x base XP and 2x base money together.",
    prerequisites: [lucky_find, skill_mastery_1, experience_multiplier_1],
    cost: 4,
    effect: SkillEffect.Balance,
    operation: EffectOperation.Message,
    messageReward: ({ baseExperience, baseBalance, roll }) => roll() < 1 / 20
        ? { experience: baseExperience * 2, balance: baseBalance * 2 }
        : null,
};

const deep_focus: Skill = {
    id: 20, name: "Deep Focus",
    description: "Adds 15% of the regular XP reward on every rewarded message.",
    prerequisites: [insightful_discovery], cost: 6, effect: SkillEffect.Experience,
    operation: EffectOperation.Message,
    messageReward: ({ regularExperience }) => ({ experience: regularExperience * 0.15 }),
};

const steady_study: Skill = {
    id: 21, name: "Steady Study",
    description: "Adds 12 XP to the regular reward on each rewarded message.",
    prerequisites: [inspiration], cost: 5, effect: SkillEffect.Experience,
    operation: EffectOperation.Add, skill: amount => amount + 12,
};

const nest_egg: Skill = {
    id: 22, name: "Nest Egg",
    description: "Adds $30 to the regular reward on each rewarded message.",
    prerequisites: [compound_interest], cost: 5, effect: SkillEffect.Balance,
    operation: EffectOperation.Add, skill: amount => amount + 30,
};

const windfall: Skill = {
    id: 23, name: "Windfall",
    description: "On each rewarded message, a 1 in 50 chance to earn 5 times the base money reward.",
    prerequisites: [nest_egg], cost: 6, effect: SkillEffect.Balance,
    operation: EffectOperation.Message,
    messageReward: ({ baseBalance, roll }) => roll() < 1 / 50 ? { balance: baseBalance * 5 } : null,
};

const field_notes: Skill = {
    id: 24, name: "Field Notes",
    description: "Multiplies your eligible message's companion appearance chance by 1.25.",
    prerequisites: [scholars_fortune], cost: 5, effect: SkillEffect.CompanionSpawn,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.25,
};

const keen_senses: Skill = {
    id: 25, name: "Keen Senses",
    description: "Multiplies Rare-or-higher companion selection weights by 1.25 when your message triggers an appearance.",
    prerequisites: [field_notes], cost: 7, effect: SkillEffect.CompanionRarity,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.25,
};

const lucky_trails: Skill = {
    id: 26, name: "Lucky Trails",
    description: "Multiplies your eligible message's companion appearance chance by 1.2.",
    prerequisites: [golden_breakthrough], cost: 7, effect: SkillEffect.CompanionSpawn,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.2,
};

const rare_insight: Skill = {
    id: 27, name: "Rare Insight",
    description: "Multiplies Rare-or-higher companion selection weights by 1.2 when your message triggers an appearance.",
    prerequisites: [discovery], cost: 6, effect: SkillEffect.CompanionRarity,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.2,
};

const companion_bond: Skill = {
    id: 28, name: "Companion Bond",
    description: "Grants one additional companion equipment slot until you prestige.",
    prerequisites: [keen_senses], cost: 10, effect: SkillEffect.CompanionSpawn,
    operation: EffectOperation.Add, skill: amount => amount + 1,
};

const house_edge_1: Skill = {
    id: 29,
    name: "House Negotiator",
    description: "Increases winning payouts in Plinko, Blackjack, Pass the Bills, and solo poker against the house by 5%; losses and multiplayer games are unaffected.",
    prerequisites: [nest_egg],
    cost: 5,
    effect: SkillEffect.Casino,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 1.05,
};

const house_edge_2: Skill = {
    id: 30,
    name: "Lucky Table",
    description: "Further increases winning payouts in Plinko, Blackjack, Pass the Bills, and solo poker against the house by 8%; losses and multiplayer games are unaffected.",
    prerequisites: [house_edge_1],
    cost: 8,
    effect: SkillEffect.Casino,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 1.08,
};

const scavenging_efficiency: Skill = {
    id: 31,
    name: "Scavenging Efficiency",
    description: "Reduces the five-minute scavenging cooldown by 15%.",
    prerequisites: [field_notes],
    cost: 2,
    effect: SkillEffect.ScavengeCooldown,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 0.85,
};

const rare_finder: Skill = {
    id: 32,
    name: "Rare Finder",
    description: "Increases the weight of Rare and higher items while scavenging by 20%.",
    prerequisites: [scavenging_efficiency],
    cost: 4,
    effect: SkillEffect.ScavengeRarity,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 1.2,
};

const extra_find: Skill = {
    id: 33,
    name: "Extra Find",
    description: "Adds a 5% chance to receive an extra item when scavenging.",
    prerequisites: [scavenging_efficiency],
    cost: 4,
    effect: SkillEffect.ScavengeFind,
    operation: EffectOperation.Add,
    skill: amount => amount + 0.05,
};

const tool_mastery: Skill = {
    id: 34,
    name: "Tool Mastery",
    description: "Allows you to equip one additional scavenging tool.",
    prerequisites: [rare_finder, extra_find],
    cost: 8,
    effect: SkillEffect.ToolSlots,
    operation: EffectOperation.Add,
    skill: amount => amount + 1,
};

const scavenging_experience: Skill = {
    id: 35,
    name: "Seasoned Scavenger",
    description: "Increases experience earned from scavenging by 25%.",
    prerequisites: [extra_find],
    cost: 5,
    effect: SkillEffect.ScavengeExperience,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 1.25,
};

const scavenging_experience_2: Skill = {
    id: 36,
    name: "Seasoned Scavenger II",
    description: "Further increases experience earned from scavenging by 35%, stacking with Seasoned Scavenger.",
    prerequisites: [scavenging_experience],
    cost: 8,
    effect: SkillEffect.ScavengeExperience,
    operation: EffectOperation.Multiply,
    skill: amount => amount * 1.35,
};

const box_hunter: Skill = {
    id: 37, name: "Box Hunter",
    description: "Increases the chance of a message lootbox by 25%.",
    prerequisites: [field_notes], cost: 4, effect: SkillEffect.LootboxDrop,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.25,
};
const box_fortune: Skill = {
    id: 38, name: "Box Fortune",
    description: "Increases higher-rarity lootbox weights by 25% per rarity tier.",
    prerequisites: [box_hunter], cost: 5, effect: SkillEffect.LootboxRarity,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.25,
};
const box_treasures: Skill = {
    id: 39, name: "Box Treasures",
    description: "Increases higher-rarity item and companion weights by 30% per rarity tier when opening lootboxes.",
    prerequisites: [box_fortune], cost: 7, effect: SkillEffect.LootboxReward,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.3,
};
const box_recovery: Skill = {
    id: 40, name: "Treasure Recovery",
    description: "Increases item and companion reward weights by 30% relative to boosts when opening a lootbox.",
    prerequisites: [box_treasures], cost: 8, effect: SkillEffect.LootboxFind,
    operation: EffectOperation.Multiply, skill: amount => amount * 1.3,
};

export function companionSkillMultiplier(keys: readonly string[], effect: SkillEffect.CompanionSpawn | SkillEffect.CompanionRarity): number {
    return keys.reduce((amount, key) => {
        const skill = getSkill(key);
        return skill && skill.operation === EffectOperation.Multiply && skill.effect === effect
            ? skill.skill(amount) : amount;
    }, 1);
}

export const skills = {
    experience_multiplier_1,
    experience_multiplier_2,
    experience_gain_1,
    experience_gain_2,
    money_multiplier_1,
    money_multiplier_2,
    extra_income,
    extra_income_2,
    skill_mastery_1,
    skill_gain_1,
    jackpot,
    lucky_find,
    compound_interest,
    inspiration,
    momentum,
    discovery,
    scholars_fortune,
    insightful_discovery,
    golden_breakthrough,
    deep_focus, steady_study, nest_egg, windfall, field_notes, keen_senses, lucky_trails, rare_insight,
    companion_bond,
    house_edge_1,
    house_edge_2,
    scavenging_efficiency,
    rare_finder,
    extra_find,
    tool_mastery,
    scavenging_experience,
    scavenging_experience_2,
    box_hunter,
    box_fortune,
    box_treasures,
    box_recovery,
};

export function getSkill(key: string): Skill | undefined {
    return Object.hasOwn(skills, key) ? skills[key as keyof typeof skills] : undefined;
}

const skillKeys = new Map(Object.entries(skills).map(([key, skill]) => [skill, key]));

export function skillPrerequisiteKeys(key: string): string[] {
    const skill = getSkill(key);
    if (!skill) throw new Error(`Unknown skill ${key}`);
    return skill.prerequisites.map(prerequisite => {
        const prerequisiteKey = skillKeys.get(prerequisite);
        if (prerequisiteKey === undefined) throw new Error(`Unknown prerequisite for skill ${key}`);
        return prerequisiteKey;
    });
}

export function availableSkills(unlocked: readonly string[]) {
    const owned = new Set(unlocked);
    return Object.entries(skills).filter(([key]) =>
        !owned.has(key) && skillPrerequisiteKeys(key).every(prerequisite => owned.has(prerequisite)));
}