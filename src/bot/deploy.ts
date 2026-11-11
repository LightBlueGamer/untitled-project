import "dotenv/config";
import { Collection, REST, Routes } from "discord.js";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "../classes/Command.js";
import { isGuildOnlyCommand, publicCommandData } from "./commandRegistration.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const supportId = process.env.DISCORD_SERVER_ID;
if (!token || !clientId || !supportId) {
    throw new Error("DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_SERVER_ID are required to register commands");
}
const commandFiles = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "commands"))
    .filter(file => file.endsWith(".js"));
const rest = new REST({ version: "10" }).setToken(token);
const commands = new Collection<Command.Data.Name, Command>();
const devCommands = new Collection<Command.Data.Name, Command>();

for (const file of commandFiles) {
    console.log(file);
    const command: Command = (await import(`./commands/${file}`)).default;
    if (isGuildOnlyCommand(command.data)) {
        devCommands.set(command.data.name, command);
    } else commands.set(command.data.name, command);
}

(async () => {
    try {
        await rest.put(Routes.applicationCommands(clientId), {
            body: commands.map((command) => publicCommandData(command.data)),
        });
        await rest.put(Routes.applicationGuildCommands(clientId, supportId), {
            body: devCommands.map((command) => command.data),
        });
    } catch (error) {
        console.error("Failed to register commands:", error);
        process.exitCode = 1;
        return;
    }
    console.log("Commands have been registered.");
})();