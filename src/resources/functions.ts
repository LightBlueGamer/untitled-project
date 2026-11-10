import { PrestigeBuff, PrestigeBuffs } from "./prestigeBuffs.js";

export function getRandomPrestigeBuff(availableBuffs: readonly PrestigeBuff[] = PrestigeBuffs): PrestigeBuff {
    const totalWeight = availableBuffs.reduce((sum, buff) => sum + buff.weight, 0);
    let randomWeight = Math.random() * totalWeight;
    for (const buff of availableBuffs) {
        randomWeight -= buff.weight;
        if (randomWeight < 0) {
            return buff;
        }
    }
    throw new Error("No prestige buff found.");
};

export function getMultipleRandomPrestigeBuffs(count: number, choices: readonly PrestigeBuff[] = PrestigeBuffs): PrestigeBuff[] {
    const selectedBuffs: PrestigeBuff[] = [];
    const availableBuffs = [...choices];

    for (let i = 0; i < count; i++) {
        if (availableBuffs.length === 0) break;
        const buff = getRandomPrestigeBuff(availableBuffs);
        selectedBuffs.push(buff);
        availableBuffs.splice(availableBuffs.indexOf(buff), 1);
    }
    return selectedBuffs;
};

export function getPrestigeBuff(id: string) {
    const buff = PrestigeBuffs.find(buff => buff.id.toString() === id);
    if(!buff) throw new Error(`No buff matching the id ${id} was found.`);
    else return buff;
};