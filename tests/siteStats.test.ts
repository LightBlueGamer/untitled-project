import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    set: vi.fn(),
    fetch: vi.fn(),
}));
vi.mock("../src/database.js", () => ({
    getCache: () => ({ set: mocks.set }),
}));

import { getHumanMemberIds, publishWebsiteDiscordStats } from "../src/bot/siteStats.js";

beforeEach(() => {
    mocks.set.mockReset().mockResolvedValue("OK");
    mocks.fetch.mockReset();
});

describe("website Discord stats", () => {
    test("counts unique human members and excludes bots", async () => {
        const guildA = {
            id: "guild-a",
            members: {
                fetch: mocks.fetch.mockResolvedValueOnce(new Map([
                    ["human-a", { id: "human-a", user: { bot: false } }],
                    ["bot", { id: "bot", user: { bot: true } }],
                ])),
            },
        };
        const guildB = {
            id: "guild-b",
            members: {
                fetch: mocks.fetch.mockResolvedValueOnce(new Map([
                    ["human-a", { id: "human-a", user: { bot: false } }],
                    ["human-b", { id: "human-b", user: { bot: false } }],
                ])),
            },
        };
        const humanIdsA = await getHumanMemberIds(guildA as never);
        const humanIdsB = await getHumanMemberIds(guildB as never);
        const client = { guilds: { cache: { size: 2 } } };

        await publishWebsiteDiscordStats(client as never, new Map([
            ["guild-a", humanIdsA],
            ["guild-b", humanIdsB],
        ]));

        expect(JSON.parse(mocks.set.mock.calls[0][1])).toMatchObject({
            guildCount: 2,
            uniqueUsers: 2,
        });
    });
});
