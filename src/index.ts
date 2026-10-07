import "dotenv/config";

import { Client, Collection, GatewayIntentBits } from "discord.js";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
    Command,
} from "./classes/Command.js";

import {
    testConnections,
    initRedis,
    disconnect,
} from "./database.js";

const token = process.env.DISCORD_TOKEN;

if (!token) {
    throw new Error("BOT_TOKEN is not configured in the environment");
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

export const eventFiles = readdirSync(
    join(__dirname, "bot", "events")
).filter((file) => file.endsWith(".js"));

export const commandFiles = readdirSync(
    join(__dirname, "bot", "commands")
).filter((file) => file.endsWith(".js"));

export const events = new Collection<string, unknown>();
export const commands = new Collection<Command.Data.Name, Command>();

async function loadCommands(): Promise<void> {
    for (const file of commandFiles) {
        const command: Command = (await import(
            `./bot/commands/${file}`
        )).default;

        if (!command?.data?.name) {
            console.warn(`Skipping invalid command file: ${file}`);
            continue;
        }

        console.log(`Loading command: ${command.data.name}`);
        commands.set(command.data.name, command);
    }

    console.log(`Loaded ${commands.size} commands.`);
}

async function loadEvents(): Promise<void> {
    for (const file of eventFiles) {
        const event = (await import(
            `./bot/events/${file}`
        )).default;

        if (!event?.name || typeof event.execute !== "function") {
            console.warn(`Skipping invalid event file: ${file}`);
            continue;
        }

        console.log(`Loading event: ${event.name}`);

        if (event.once) {
            client.once(event.name, (...args: unknown[]) =>
                event.execute(...args)
            );
        } else {
            client.on(event.name, (...args: unknown[]) =>
                event.execute(...args)
            );
        }

        events.set(event.name, event);
    }

    console.log(`Loaded ${events.size} events.`);
}

async function start(): Promise<void> {
    try {
        await initRedis();
        await testConnections();

        await loadCommands();
        await loadEvents();

        await client.login(token);

        console.log(`Logged in as ${client.user?.tag ?? "Discord bot"}`);
    } catch (error) {
        console.error("❌ Failed to start bot:", error);

        await disconnect().catch((disconnectError) => {
            console.error(
                "Failed to close database connections:",
                disconnectError
            );
        });

        process.exitCode = 1;
    }
}

async function shutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}. Shutting down...`);

    client.destroy();
    await disconnect();

    process.exit(0);
}

process.once("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
});

void start();