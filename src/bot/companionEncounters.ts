import { randomUUID } from "node:crypto";
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
    type ButtonInteraction, type Client, type Message,
} from "discord.js";
import Player from "../classes/Player.js";
import {
    cancelCompanionEncounter, catchCompanionEncounter, createCompanionEncounter,
    expireCompanionEncounter, getCompanionChannelState, getCompanionCirculation,
    getOpenCompanionEncounters, saveCompanionChannelState, setEncounterMessage,
    type CompanionChannelState, type CompanionEncounter,
} from "../companionStorage.js";
import { companionSelectionWeights, getCompanion, type Companion } from "../resources/companions.js";
import { debugLog } from "../debugSettings.js";
import { companionSkillMultiplier, SkillEffect } from "../resources/skills.js";

const denominator = 1_000;
const catchQueues = new Map<string, Promise<void>>();
const encounterQueues = new Map<string, Promise<void>>();

export function chooseCompanion(circulation: readonly { key: string; quantity: string }[], active: Companion | readonly Companion[] | undefined, roll: number, rareMultiplier = 1): string {
    const weighted = companionSelectionWeights(circulation, active, rareMultiplier);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let remaining = roll * total;
    for (const item of weighted) {
        remaining -= item.weight;
        if (remaining < 0) return item.key;
    }
    return weighted[weighted.length - 1].key;
}

function catchButton(id: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`companion_catch:${id}`).setLabel("Catch")
            .setStyle(ButtonStyle.Success),
    );
}

async function updateExpiredMessage(client: Client, encounter: CompanionEncounter): Promise<void> {
    if (!await expireCompanionEncounter(encounter.id)) return;
    const channel = await client.channels.fetch(encounter.channel_id);
    if (!channel || !channel.isTextBased() || !("messages" in channel) || !encounter.message_id) {
        throw new Error(`Cannot access expired encounter message ${encounter.id}`);
    }
    const message = await channel.messages.fetch(encounter.message_id);
    const name = getCompanion(encounter.companion_key)?.name ?? encounter.companion_key;
    await message.edit({ content: `${name} escaped!`, components: [] });
}

function scheduleExpiry(client: Client, encounter: CompanionEncounter): void {
    const delay = Math.max(0, encounter.expires_at.getTime() - Date.now()) + 100;
    setTimeout(() => {
        void updateExpiredMessage(client, encounter).catch(error => console.error("Failed to expire companion encounter:", error));
    }, delay);
}

export async function restoreCompanionEncounters(client: Client): Promise<void> {
    const encounters = await getOpenCompanionEncounters();
    for (const encounter of encounters) scheduleExpiry(client, encounter);
}

async function spawn(message: Message, player: Player | null): Promise<void> {
    let id: string | undefined;
    let announcement: Message | undefined;
    try {
        const circulation = await getCompanionCirculation();
        const equipped = player?.equippedCompanions ?? [];
        const active = equipped.map(getCompanion).filter((companion): companion is Companion => companion !== undefined);
        const rareMultiplier = companionSkillMultiplier(player?.skills ?? [], SkillEffect.CompanionRarity)
            * (player?.prestigeCompanionRarityMultiplier ?? 1);
        const key = chooseCompanion(circulation, active, Math.random(), rareMultiplier);
        const companion = getCompanion(key);
        if (!companion) throw new Error(`Unknown selected companion: ${key}`);
        id = randomUUID();
        await createCompanionEncounter(id, message.channelId, key);
        if (!message.channel.isSendable()) throw new Error("Cannot send a companion encounter in this channel");
        announcement = await message.channel.send({ content: `A wild **${companion.name}** (${companion.rarity}) appeared!` });
        const encounter = await setEncounterMessage(id, announcement.id);
        scheduleExpiry(message.client, encounter);
        await announcement.edit({
            content: `A wild **${companion.name}** (${companion.rarity}) appeared! Catch it within 30 seconds!`,
            components: [catchButton(id)],
        });
    } catch (error) {
        if (id) {
            try {
                await cancelCompanionEncounter(id);
            } catch (cleanupError) {
                console.error("Failed to cancel companion encounter:", cleanupError);
            }
        }
        if (announcement) {
            try {
                await announcement.edit({ content: "The companion could not appear. Please try again later.", components: [] });
            } catch (editError) {
                console.error("Failed to update unsuccessful companion encounter:", editError);
            }
        }
        console.error("Failed to spawn companion:", error);
    }
}

export async function handleEncounterMessage(message: Message): Promise<boolean> {
    if (!message.guild || message.author.bot) return false;
    const previous = encounterQueues.get(message.channelId) ?? Promise.resolve();
    const operation = previous.then(async () => {
        const storedState = await getCompanionChannelState(message.channelId);
        if (storedState?.lastUserId === message.author.id) return;

        const channelState: CompanionChannelState = storedState
            ? { ...storedState, lastUserId: message.author.id }
            : {
                chance: 1,
                lastUserId: message.author.id,
            };
        await saveCompanionChannelState(message.channelId, channelState);
        const player = await Player.findById(message.author.id);
        const multiplier = companionSkillMultiplier(player?.skills ?? [], SkillEffect.CompanionSpawn)
            * (player?.prestigeCompanionSpawnMultiplier ?? 1);
        const chance = Math.min(denominator, channelState.chance * multiplier);
        debugLog("chance", message.channelId, `Channel ${message.channelId}: ${chance}/${denominator}`);
        if (Math.random() * denominator < chance) {
            channelState.chance = 1;
            await saveCompanionChannelState(message.channelId, channelState);
            await spawn(message, player);
        } else {
            channelState.chance = Math.min(denominator, channelState.chance + 1 + Math.floor(Math.random() * 10));
            await saveCompanionChannelState(message.channelId, channelState);
        }
    });
    const settled = operation.then(() => undefined, () => undefined);
    encounterQueues.set(message.channelId, settled);
    try {
        await operation;
    } finally {
        if (encounterQueues.get(message.channelId) === settled) encounterQueues.delete(message.channelId);
    }
    return false;
}

export async function handleCatchButton(interaction: ButtonInteraction): Promise<void> {
    const match = /^companion_catch:([0-9a-f-]{36})$/.exec(interaction.customId);
    if (!match) {
        await interaction.reply({ content: "Invalid companion encounter.", flags: [MessageFlags.Ephemeral] });
        return;
    }
    const deferred = interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const id = match[1];
    const previous = catchQueues.get(id) ?? Promise.resolve();
    const operation = previous.then(async () => {
        await deferred;
        const key = await catchCompanionEncounter(id, interaction.channelId, interaction.message.id, interaction.user.id, interaction.user.username);
        if (!key) {
            await interaction.editReply("This companion has already been caught or escaped.");
            return;
        }
        const name = getCompanion(key)?.name ?? key;
        try {
            await interaction.message.edit({ content: `<@${interaction.user.id}> caught **${name}**!`, components: [] });
        } catch (error) {
            console.error("Failed to update caught companion message:", error);
        }
        await interaction.editReply(`You caught ${name}!`);
    });
    const settled = operation.then(() => undefined, () => undefined);
    catchQueues.set(id, settled);
    try {
        await operation;
    } finally {
        if (catchQueues.get(id) === settled) catchQueues.delete(id);
    }
}
