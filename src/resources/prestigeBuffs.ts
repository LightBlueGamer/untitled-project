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
    }
]