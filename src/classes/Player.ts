export default class Player {
    name: string;
    id: string;
    data: Data;

    constructor(
        name: string,
        id: string,
        data: Data = defaultPlayerData,
    ) {
        this.name = name;
        this.id = id;
        this.data = data;
    }
}

export interface Data {
    balance: number;
    experience: number;
    level: number;
}

export const defaultPlayerData: Data = {
    balance: 0,
    experience: 0,
    level: 1
};