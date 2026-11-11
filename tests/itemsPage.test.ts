import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    textContent = "";
    value = "";
    className = "";
    href = "";
    dataset: Record<string, string> = {};
    children: Element[] = [];
    attributes: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    arrow = { textContent: "" };
    header = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
    appendChild(child: Element) { this.children.push(child); }
    append(...children: Element[]) { this.children.push(...children); }
    add(option: Element) { this.children.push(option); }
    replaceChildren(...children: Element[]) { this.children = children; }
    addEventListener(event: string, handler: () => void) { this.listeners[event] = handler; }
    querySelector() { return this.arrow; }
    closest() { return this.header; }
}

describe("item pages", () => {
    test("catalog supports search, category filtering, sorting and detail links", async () => {
        const names = ["itemStatus", "itemBody", "itemRetry", "itemSearch", "itemCategory"];
        const nodes = Object.fromEntries(names.map(name => [name, new Element()]));
        const buttons = ["name", "category", "rarity", "price", "odds", "circulation", "source"].map(key => {
            const button = new Element();
            button.dataset.sort = key;
            return button;
        });
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                categories: ["Material", "Tool"],
                items: [
                    { key: "iron_ore", name: "Iron Ore", category: "Material", rarity: "Uncommon", price: 18, odds: 123.4, circulation: "450", canScavenge: true, source: "Scavengable" },
                    { key: "iron_pick", name: "Iron Pick", category: "Tool", rarity: "Rare", price: 100, odds: null, circulation: "2", canScavenge: false, source: "Crafted" },
                    { key: "small_pouch", name: "Small Pouch", category: "Backpack", rarity: "Common", price: 0, odds: null, circulation: "3", source: "Starter" },
                ],
            }),
        });
        const context = createContext({
            fetch,
            document: {
                querySelector: (selector: string) => nodes[selector.slice(1)],
                querySelectorAll: () => buttons,
                createElement: () => new Element(),
            },
        });
        runInContext(readFileSync("public/scripts/items.js", "utf8"), context);
        await vi.waitFor(() => expect(nodes.itemBody.children).toHaveLength(3));
        expect(nodes.itemStatus.textContent).toBe("3 of 3 items");
        expect(nodes.itemBody.children[0].children[0].children[0].href).toBe("/item?key=iron_pick");
        expect(nodes.itemBody.children[0].children[5].textContent).toBe("2");
        expect(nodes.itemBody.children[0].children[4].textContent).toBe("—");
        expect(nodes.itemBody.children[2].children[6].textContent).toBe("Starter");
        buttons[5].listeners.click();
        expect(nodes.itemBody.children[0].children[0].children[0].textContent).toBe("Iron Ore");
        expect(nodes.itemBody.children[0].children[4].textContent).toBe("1 in 123");
        nodes.itemSearch.value = "iron ore";
        nodes.itemSearch.listeners.input();
        expect(nodes.itemBody.children).toHaveLength(1);
        expect(nodes.itemStatus.textContent).toBe("1 of 3 items");
        nodes.itemSearch.value = "";
        nodes.itemCategory.value = "Material";
        nodes.itemCategory.listeners.change();
        expect(nodes.itemBody.children).toHaveLength(1);
        buttons[0].listeners.click();
        expect(nodes.itemBody.children[0].children[0].children[0].textContent).toBe("Iron Ore");
    });

    test("item detail shows recipe and tool effect, and handles missing keys", async () => {
        const names = [
            "itemStatus", "itemDetails", "itemRetry", "itemName", "itemType", "itemDescription",
            "itemPrice", "itemOdds", "itemCirculation", "itemScavenge", "itemRecipeSection", "itemRecipe",
            "itemToolBonusSection", "itemToolBonusHeading", "itemToolBonus", "itemToolRulesSection", "itemToolRules",
        ];
        const nodes = Object.fromEntries(names.map(name => [name, new Element()]));
        const fetch = vi.fn()
            .mockResolvedValueOnce({ status: 404, ok: false })
            .mockResolvedValueOnce({
                status: 200,
                ok: true,
                json: async () => ({
                    name: "Iron Pick", rarity: "Rare", category: "Tool", description: "A pick.",
                    price: 100, weight: 0, canScavenge: false,
                    circulation: "42",
                    recipe: [{ name: "Fieldstone", quantity: 3 }],
                    toolsWithBonus: [], blacklistTools: [],
                    toolBonus: "1.8× chance weight for Material items",
                }),
            });
        const context = createContext({
            fetch, URLSearchParams, location: { search: "?key=iron_pick" },
            document: { querySelector: (selector: string) => nodes[selector.slice(1)], createElement: () => new Element() },
        });
        runInContext(readFileSync("public/scripts/item.js", "utf8"), context);
        await vi.waitFor(() => expect(nodes.itemStatus.textContent).toContain("not found"));
        nodes.itemRetry.listeners.click();
        await vi.waitFor(() => expect(nodes.itemName.textContent).toBe("Iron Pick"));
        expect(nodes.itemDetails.className).toBe("rarity-rare");
        expect(nodes.itemRecipe.children[0].textContent).toBe("Fieldstone × 3");
        expect(nodes.itemToolBonus.textContent).toContain("Material");
        expect(nodes.itemScavenge.textContent).toBe("No");
        expect(nodes.itemCirculation.textContent).toBe("42");
    });
});
