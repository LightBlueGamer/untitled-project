export default class Player {
    public name: string;
    public readonly id: string;
    protected data: Data;

    constructor(
        name: string,
        id: string,
        data: Data = defaultPlayerData,
    ) {
        this.name = name;
        this.id = id;
        this.data = { ...data };
    }

    public get balance(): number {
        return this.data.balance;
    }

    public addBalance(amount: number): Player {
        this.assertPositiveAmount(amount);
        this.data.balance += amount;
        return this;
    }

    public subtractBalance(amount: number): Player {
        this.assertPositiveAmount(amount);
        this.assertSufficientBalance(amount);
        this.data.balance -= amount;
        return this;
    }

    public get experience(): number {
        return this.data.experience;
    }

    public addExperience(amount: number): ExperienceResult {
        this.assertPositiveAmount(amount);
        const previousLevel = this.data.level;
        this.data.experience += amount;
        while (this.data.experience >= this.xpForNextLevel(this.data.level)) {
            this.data.experience -= this.xpForNextLevel(this.data.level);
            this.data.level += 1;
        }
        const currentLevel = this.data.level;
        const levelsGained = currentLevel - previousLevel;

        return {
            player: this,
            previousLevel,
            currentLevel,
            levelsGained,
            didLevelUp: levelsGained > 0,
        };
    }

    public assignRandomExperienceAndBalance(): Player {
        this.addExperience(
            Math.floor((Math.random() * 26 + 15) * this.experienceMultiplier),
        );
        this.addBalance(
            Math.floor((Math.random() * 101 + 50) * this.balanceMultiplier),
        );
        return this;
    }

    public get level(): number {
        return this.data.level;
    }

    private assertPositiveAmount(amount: number) {
        if(amount <= 0) throw new Error('Amount must be a positive number');
    }

    private assertSufficientBalance(amount: number) {
        if (amount > this.data.balance) throw new Error('Insufficient balance');
    }

    private xpForNextLevel(level: number): number {
        if (level < 1) {
            throw new Error('Level must be at least 1');
        }

        return Math.floor(
            25 +
            15 * level +
            50 * Math.pow(1.15, level - 1),
        );
    }

    public get experienceMultiplier(): number {
        return this.data.experienceMultiplier;
    }

    public get balanceMultiplier(): number {
        return this.data.balanceMultiplier;
    }
}

export interface Data {
    balance: number;
    experience: number;
    level: number;
    experienceMultiplier: number;
    balanceMultiplier: number;
}

export const defaultPlayerData: Data = {
    balance: 0,
    experience: 0,
    level: 1,
    experienceMultiplier: 1.00,
    balanceMultiplier: 1.00,
};

export interface ExperienceResult {
    player: Player;
    previousLevel: number;
    currentLevel: number;
    levelsGained: number;
    didLevelUp: boolean;
}