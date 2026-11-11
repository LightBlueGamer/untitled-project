import { afterEach, describe, expect, test, vi } from "vitest";
import type { AutocompleteInteraction } from "discord.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/itemStorage.js", () => ({
    getPlayerItems: vi.fn(),
    getPlayerScavengeState: vi.fn(),
}));

import { getPlayerItems, getPlayerScavengeState } from "../src/itemStorage.js";
import autocomplete from "../src/bot/events/autoCompleteInteraction.js";

afterEach(() => vi.resetAllMocks());

describe("backpack autocomplete", () => {
    test("counts the equipped pouch toward the next upgrade recipe", async () => {
        vi.mocked(getPlayerItems).mockResolvedValue([{ key: "scrap_cloth", quantity: 3 }]);
        vi.mocked(getPlayerScavengeState).mockResolvedValue({
            equippedTools: [], nextScavengeAt: null, backpackKey: "small_pouch",
        });
        const respond = vi.fn();
        await autocomplete.execute({
            commandName: "craft", user: { id: "1" }, options: { getFocused: () => "shoulder" }, respond,
        } as unknown as AutocompleteInteraction);
        expect(respond).toHaveBeenCalledWith([
            expect.objectContaining({ value: "shoulder_bag", name: expect.stringContaining("Small Pouch 1/1") }),
        ]);
    });

    test("suggests only matching sellable owned items", async () => {
        vi.mocked(getPlayerItems).mockResolvedValue([
            { key: "wild_berries", quantity: 5 }, { key: "small_pouch", quantity: 1 }, { key: "retired", quantity: 1 },
        ]);
        const respond = vi.fn();
        await autocomplete.execute({
            commandName: "sell", user: { id: "1" }, options: { getFocused: () => "" }, respond,
        } as unknown as AutocompleteInteraction);
        expect(respond).toHaveBeenCalledWith([
            expect.objectContaining({ value: "wild_berries", name: expect.stringContaining("5 owned") }),
        ]);
    });
});
