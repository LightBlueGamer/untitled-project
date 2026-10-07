import type {
    ChatInputCommandInteraction,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export class Command {
    devMode: boolean;
    data: Command.Data;
    execute: Function;

    constructor(
        devMode: boolean,
        data: Command.Data,
        execute: (interaction: ChatInputCommandInteraction) => {}
    ) {
        this.devMode = devMode;
        this.data = data;
        this.execute = execute;
    }
}

export namespace Command {
    export type devMode = boolean;
    export type Data = RESTPostAPIChatInputApplicationCommandsJSONBody;

    export namespace Data {
        export type Name = string;
    }
}