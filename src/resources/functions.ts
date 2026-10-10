import { PrestigeBuff, PrestigeBuffs } from "./prestigeBuffs.js";

export function getRandomPrestigeBuff(): PrestigeBuff {
    const totalWeight = PrestigeBuffs.reduce((sum, buff) => sum + buff.weight, 0);
    let randomWeight = Math.random() * totalWeight;
    for (const buff of PrestigeBuffs) {
        randomWeight -= buff.weight;
        if (randomWeight <= 0) {
            return buff;
        }
    }
    throw new Error("No prestige buff found.");
};

export function getMultipleRandomPrestigeBuffs(count: number): PrestigeBuff[] {
    const selectedBuffs: PrestigeBuff[] = [];
    const availableBuffs = [...PrestigeBuffs];

    for (let i = 0; i < count; i++) {
        if (availableBuffs.length === 0) break;
        const buff = getRandomPrestigeBuff();
        selectedBuffs.push(buff);
    }
    return selectedBuffs;
};

export function getPrestigeBuff(id: string) {
    const buff = PrestigeBuffs.find(buff => buff.id.toString() === id);
    if(!buff) throw new Error(`No buff matching the id ${id} was found.`);
    else return buff;
};