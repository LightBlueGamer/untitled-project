export interface Skill {
    id: number;
    name: string;
    description: string;
    prerequisite: Skill | null;
    effect: SkillEffect;
    operation: EffectOperation;
    cost: number;
    skill: (amount: number) => number;
}

export enum SkillEffect {
    Experience = "experience",
    Balance = "balance",
    Skill = "skill",
}

export enum EffectOperation {
    Add = "add",
    Multiply = "multiply"
}

// Experience related skills

const experience_gain_1: Skill = {
    id: 1,
    name: "Experience Gain I",
    description: "Gives a bonus 10 experience every time you gain experience",
    prerequisite: null,
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
    prerequisite: experience_gain_1,
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
    prerequisite: experience_gain_1,
    cost: 1,
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
    prerequisite: experience_multiplier_1,
    cost: 2,
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
    prerequisite: null,
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
    prerequisite: extra_income,
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
    prerequisite: extra_income,
    cost: 1,
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
    prerequisite: money_multiplier_1,
    cost: 2,
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
    prerequisite: null,
    cost: 1,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Add,
    skill: (amount: number) => {
        return amount + 1;
    }
};

const skill_gain_1: Skill = {
    id: 10,
    name: "Skill Gain I",
    description: "Increases skill points gained (1.25x)",
    prerequisite: skill_mastery_1,
    cost: 2,
    effect: SkillEffect.Skill,
    operation: EffectOperation.Multiply,
    skill: (amount: number) => {
        return amount * 1.5;
    }
};

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
    skill_gain_1
};

export function getSkill(key: string): Skill | undefined {
    return skills[key as keyof typeof skills];
}