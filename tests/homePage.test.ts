import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

describe("homepage install links", () => {
    test("shows the account and server install links", async () => {
        const nodes = new Map<string, {
            href: string; textContent: string; classList: { add: ReturnType<typeof vi.fn> };
            replaceChildren: ReturnType<typeof vi.fn>; appendChild: ReturnType<typeof vi.fn>;
        }>();
        const querySelector = (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, {
                href: "", textContent: "", classList: { add: vi.fn() },
                replaceChildren: vi.fn(), appendChild: vi.fn(),
            });
            return nodes.get(selector)!;
        };
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                guildCount: 0, uniqueUsers: 0, totalBalance: "0", totalExperience: "0",
                topPlayers: [], discordStatsUpdatedAt: null,
                inviteUrl: "https://discord.example/server",
                userInstallUrl: "https://discord.example/user",
            }),
        });
        const context = createContext({
            fetch, document: { querySelector, createElement: () => ({}) }, console,
        });
        runInContext(readFileSync("public/scripts/home.js", "utf8"), context);
        await vi.waitFor(() => expect(querySelector("#installUser").href).toBe("https://discord.example/user"));
        expect(querySelector("#inviteBot").href).toBe("https://discord.example/server");
        expect(querySelector("#installUser").classList.add).not.toHaveBeenCalledWith("hidden");
    });
});
