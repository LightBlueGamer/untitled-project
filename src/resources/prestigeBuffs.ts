import Player from "../classes/Player.js";

export interface PrestigeBuff {
    weight: number;
    name: string;
    description: string;
    buff: (player: Player) => void;
    id: number;
}

export const PrestigeBuffs: PrestigeBuff[] = [
    {
        weight: 10000,
        name: "Small Experience Boost",
        description: "Increases your experience gain by 1.5%",
        buff: (player: Player) => {
            player.experienceMultiplier += .015;
        },
        id: 1
    },
    {
        weight: 10000,
        name: "Small Money Boost",
        description: "Increases your money gain by 1.5%",
        buff: (player: Player) => {
            player.balanceMultiplier += .015;
        },
        id: 2
    },
    {
        weight: 8000,
        name: "Medium Experience Boost",
        description: "Increases your experience gain by 3%",
        buff: (player: Player) => {
            player.experienceMultiplier += .03;
        },
        id: 3
    },
    {
        weight: 8000,
        name: "Medium Money Boost",
        description: "Increases your money gain by 3%",
        buff: (player: Player) => {
            player.balanceMultiplier += .03;
        },
        id: 4
    },
    {
        weight: 5000,
        name: "Large Experience Boost",
        description: "Increases your experience gain by 5%",
        buff: (player: Player) => {
            player.experienceMultiplier += .05;
        },
        id: 5
    },
    {
        weight: 5000,
        name: "Large Money Boost",
        description: "Increases your money gain by 5%",
        buff: (player: Player) => {
            player.balanceMultiplier += .05;
        },
        id: 6
    },
    {
        weight: 2000,
        name: "Huge Experience Boost",
        description: "Increases your experience gain by 10%",
        buff: (player: Player) => {
            player.experienceMultiplier += .1;
        },
        id: 7
    },
    {
        weight: 2000,
        name: "Huge Money Boost",
        description: "Increases your money gain by 10%",
        buff: (player: Player) => {
            player.balanceMultiplier += .1;
        },
        id: 8
    },
    {
        weight: 1000,
        name: "Small Experience Boost Multiplier",
        description: "Increases your experience gain multiplier by 1.25%",
        buff: (player: Player) => {
            player.experienceMultiplier *= 1.0125;
        },
        id: 9
    },
    {
        weight: 1000,
        name: "Small Money Boost Multiplier",
        description: "Increases your money gain multiplier by 1.25%",
        buff: (player: Player) => {
            player.balanceMultiplier *= 1.0125;
        },
        id: 10
    },
    {
        weight: 500,
        name: "Medium Experience Boost Multiplier",
        description: "Increases your experience gain multiplier by 2.5%",
        buff: (player: Player) => {
            player.experienceMultiplier *= 1.025;
        },
        id: 11
    },
    {
        weight: 500,
        name: "Medium Money Boost Multiplier",
        description: "Increases your money gain multiplier by 2.5%",
        buff: (player: Player) => {
            player.balanceMultiplier *= 1.025;
        },
        id: 12
    },
    {
        weight: 250,
        name: "Large Experience Boost Multiplier",
        description: "Increases your experience gain multiplier by 5%",
        buff: (player: Player) => {
            player.experienceMultiplier *= 1.05;
        },
        id: 13
    },
    {
        weight: 250,
        name: "Large Money Boost Multiplier",
        description: "Increases your money gain multiplier by 5%",
        buff: (player: Player) => {
            player.balanceMultiplier *= 1.05;
        },
        id: 14
    },
    {
        weight: 100,
        name: "Huge Experience Boost Multiplier",
        description: "Increases your experience gain multiplier by 10%",
        buff: (player: Player) => {
            player.experienceMultiplier *= 1.1;
        },
        id: 15
    },
    {
        weight: 100,
        name: "Huge Money Boost Multiplier",
        description: "Increases your money gain multiplier by 10%",
        buff: (player: Player) => {
            player.balanceMultiplier *= 1.1;
        },
        id: 16
    },
    {
        id: 17,
        weight: 6500,
        name: "Quick Learner",
        description: "Permanently adds 3 XP to each base message reward, before multipliers.",
        buff: player => player.addPrestigeExperienceFlat(3),
    },
    {
        id: 18,
        weight: 3000,
        name: "Dedicated Learner",
        description: "Permanently adds 6 XP to each base message reward, before multipliers.",
        buff: player => player.addPrestigeExperienceFlat(6),
    },
    {
        id: 19,
        weight: 6500,
        name: "Loose Change",
        description: "Permanently adds $10 to each base message reward, before multipliers.",
        buff: player => player.addPrestigeBalanceFlat(10),
    },
    {
        id: 20,
        weight: 3000,
        name: "Steady Income",
        description: "Permanently adds $20 to each base message reward, before multipliers.",
        buff: player => player.addPrestigeBalanceFlat(20),
    },
    {
        id: 21,
        weight: 5500,
        name: "Balanced Growth",
        description: "Permanently adds 1% to both your XP and money multipliers.",
        buff: player => {
            player.experienceMultiplier += .01;
            player.balanceMultiplier += .01;
        },
    },
    {
        id: 22,
        weight: 1800,
        name: "Versatile Growth",
        description: "Permanently adds 2.5% to both your XP and money multipliers.",
        buff: player => {
            player.experienceMultiplier += .025;
            player.balanceMultiplier += .025;
        },
    },
    {
        id: 23,
        weight: 4000,
        name: "Companion Trail",
        description: "Permanently adds 5% to your companion appearance multiplier on your eligible messages.",
        buff: player => player.addPrestigeCompanionSpawnBonus(.05),
    },
    {
        id: 24,
        weight: 1500,
        name: "Wildlife Magnet",
        description: "Permanently adds 10% to your companion appearance multiplier on your eligible messages.",
        buff: player => player.addPrestigeCompanionSpawnBonus(.1),
    },
    {
        id: 25,
        weight: 3500,
        name: "Rare Trail",
        description: "Permanently adds 5% to your Rare-or-higher companion selection weight multiplier.",
        buff: player => player.addPrestigeCompanionRarityBonus(.05),
    },
    {
        id: 26,
        weight: 1200,
        name: "Rare Beacon",
        description: "Permanently adds 10% to your Rare-or-higher companion selection weight multiplier.",
        buff: player => player.addPrestigeCompanionRarityBonus(.1),
    },
    {
        id: 27,
        weight: 2500,
        name: "Fresh Start",
        description: "Receive 3 skill points immediately after this prestige; they reset on your next prestige.",
        buff: player => { player.skillPoints += 3; },
    },
    {
        id: 28,
        weight: 800,
        name: "Head Start",
        description: "Receive 6 skill points immediately after this prestige; they reset on your next prestige.",
        buff: player => { player.skillPoints += 6; },
    },
    {
        id: 29,
        weight: 1500,
        name: "Companion Keeper",
        description: "Permanently grants one additional companion equipment slot.",
        buff: player => player.grantPrestigeCompanionSlot(),
    },
    {
        id: 30,
        weight: 4000,
        name: "Lucky Charm",
        description: "Permanently increases winning payouts in Plinko, Blackjack, Pass the Bills, and solo poker against the house by 3%; losses and multiplayer games are unaffected.",
        buff: player => player.addPrestigeCasinoPayoutBonus(.03),
    },
    {
        id: 31,
        weight: 1500,
        name: "House Whisperer",
        description: "Permanently increases winning payouts in Plinko, Blackjack, Pass the Bills, and solo poker against the house by 6%; losses and multiplayer games are unaffected.",
        buff: player => player.addPrestigeCasinoPayoutBonus(.06),
    },
    {
        id: 32, weight: 3500, name: "Box Seeker",
        description: "Permanently increases message lootbox chance by 15%.",
        buff: player => player.addPrestigeLootboxBonus("drop", .15),
    },
    {
        id: 33, weight: 2500, name: "Box Collector",
        description: "Permanently improves higher-rarity lootbox odds by 15% per rarity tier.",
        buff: player => player.addPrestigeLootboxBonus("rarity", .15),
    },
    {
        id: 34, weight: 2000, name: "Treasure Instinct",
        description: "Permanently improves higher-rarity lootbox reward odds by 20% per rarity tier.",
        buff: player => player.addPrestigeLootboxBonus("reward", .2),
    },
    {
        id: 35, weight: 2000, name: "Treasure Recovery",
        description: "Permanently increases item and companion lootbox reward weights by 20% relative to boosts.",
        buff: player => player.addPrestigeLootboxBonus("find", .2),
    },
];