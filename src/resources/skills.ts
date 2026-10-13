export interface Skill {
    id: number;
    name: string;
    description: string;
    prerequisite: string | null;
    skill: (...args: never[]) => unknown;
}

export const skills: Skill[] = [
    {
        id: 0,
        name: "Experience Boost",
        description: "Gives more experience points when sending messages (1.25x)",
        prerequisite: null,
        skill: (amount: number) => {
            return amount * 1.25;
        },
    }
]