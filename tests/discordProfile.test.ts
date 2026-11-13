import { afterEach, describe, expect, test, vi } from "vitest";

const cache = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../src/database.js", () => ({ getCache: () => cache }));
import { getDiscordProfile } from "../src/discordProfile.js";

const id = "123456789012345678";
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    cache.get.mockReset();
    cache.set.mockReset();
});

describe("Discord profile lookup", () => {
    test("fetches and caches animated avatars and usernames", async () => {
        vi.stubEnv("DISCORD_TOKEN", "test-token");
        cache.get.mockResolvedValue(null);
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
            id, username: "alice", avatar: `a_${"a".repeat(32)}`, discriminator: "0",
        }) });
        vi.stubGlobal("fetch", fetch);
        const result = await getDiscordProfile(id);
        expect(result).toEqual({ username: "alice", avatarUrl: `https://cdn.discordapp.com/avatars/${id}/a_${"a".repeat(32)}.gif?size=256` });
        expect(cache.set).toHaveBeenCalledWith(`discord-profile:${id}`, JSON.stringify(result), { EX: 3600 });
        cache.get.mockResolvedValue(JSON.stringify(result));
        expect(await getDiscordProfile(id)).toEqual(result);
        expect(fetch).toHaveBeenCalledOnce();
    });

    test("uses Discord's default avatar for users without one", async () => {
        vi.stubEnv("DISCORD_TOKEN", "test-token");
        cache.get.mockResolvedValue(null);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
            id, username: "alice", avatar: null, discriminator: "0",
        }) }));
        expect(await getDiscordProfile(id)).toEqual({
            username: "alice", avatarUrl: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`,
        });
    });

    test("handles missing credentials and reports Discord errors", async () => {
        vi.stubEnv("DISCORD_TOKEN", "");
        expect(await getDiscordProfile(id)).toBeNull();
        vi.stubEnv("DISCORD_TOKEN", "test-token");
        cache.get.mockResolvedValue(null);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await getDiscordProfile(id)).toBeNull();
        expect(log).toHaveBeenCalled();
        expect(cache.set).not.toHaveBeenCalled();
    });
});
