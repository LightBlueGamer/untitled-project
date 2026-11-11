import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    textContent = "";
    value = "";
    className = "";
    href = "";
    children: Element[] = [];
    dataset: Record<string, string> = {};
    attributes: Record<string, string> = {};
    listeners: Record<string, () => void> = {};
    arrow = { textContent: "" };
    header = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
    classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() };
    appendChild(child: Element) { this.children.push(child); }
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    addEventListener(event: string, handler: () => void) { this.listeners[event] = handler; }
    querySelector() { return this.arrow; }
    closest() { return this.header; }
}

describe("companion circulation page", () => {
    test("sorts by rarity, name and exact counts, renders safe links and retries", async () => {
        const status = new Element(), body = new Element(), retry = new Element();
        const buttons = ["name", "rarity", "quantity"].map(key => {
            const button = new Element();
            button.dataset.sort = key;
            return button;
        });
        const search = new Element();
        const nodes: Record<string, Element> = {
            companionStatus: status, companionBody: body, companionRetry: retry, companionSearch: search,
        };
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ companions: [
                { name: "Mossprout", key: "mossprout", rarity: "Common", quantity: "9007199254740993" },
                { name: "Auroragon", key: "auroragon", rarity: "Eternal", quantity: "9007199254740992" },
                { name: null, key: "old", rarity: null, quantity: "0" },
            ] }) });
        const context = createContext({
            fetch,
            document: {
                querySelector: (selector: string) => nodes[selector.slice(1)],
                querySelectorAll: () => buttons,
                createElement: () => new Element(),
            },
        });
        runInContext(readFileSync("public/scripts/companions.js", "utf8"), context);
        await vi.waitFor(() => expect(status.textContent).toContain("503"));
        expect(retry.classList.remove).toHaveBeenCalledWith("hidden");
        await runInContext("loadCompanionCirculation()", context);
        expect(status.textContent).toBe("3 companion species");
        expect(body.children.map(row => row.className)).toEqual(["rarity-eternal", "rarity-common", "rarity-retired"]);
        expect(body.children[0].children[0].children[0].href).toBe("/companion?key=auroragon");
        expect(body.children[2].children[0].textContent).toBe("old (retired)");
        buttons[0].listeners.click();
        expect(body.children[0].children[0].children[0].textContent).toBe("Auroragon");
        buttons[2].listeners.click();
        expect(body.children[0].children[0].children[0].textContent).toBe("Mossprout");
        expect(body.children[0].children[2].textContent).toBe(BigInt("9007199254740993").toLocaleString());
        expect(buttons[2].header.setAttribute).toHaveBeenLastCalledWith("aria-sort", "descending");
        buttons[2].listeners.click();
        expect(body.children[0].children[0].textContent).toBe("old (retired)");
        search.value = "ETERNAL";
        search.listeners.input();
        expect(body.children).toHaveLength(1);
        expect(body.children[0].children[0].children[0].textContent).toBe("Auroragon");
        expect(status.textContent).toBe("1 of 3 companion species");
        search.value = "OLD";
        search.listeners.input();
        expect(body.children[0].children[0].textContent).toBe("old (retired)");
        search.value = "moss";
        search.listeners.input();
        expect(body.children[0].children[0].children[0].textContent).toBe("Mossprout");
        search.value = "does-not-exist";
        search.listeners.input();
        expect(body.children).toHaveLength(0);
        expect(status.textContent).toBe("No companions match your search.");
    });

    test("wiki displays stats and small nonzero odds and reports errors", async () => {
        const names = ["wikiStatus", "wikiDetails", "wikiRetry", "wikiName", "wikiRarity", "wikiDescription", "wikiCount", "wikiWeight", "wikiChance", "wikiStats"];
        const nodes = Object.fromEntries(names.map(name => [name, new Element()]));
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockResolvedValueOnce({ ok: true, json: async () => ({
                name: "Auroragon", rarity: "Eternal", description: "A dragon",
                quantity: "2", weight: 0.196078431372549, percentage: 0.000000000034,
                stats: { HP: 120, DMG: 70, DEF: 60, SPD: 55, CRIT: 18 },
            }) });
        const context = createContext({
            fetch, URLSearchParams, location: { search: "?key=auroragon" },
            document: { querySelector: (selector: string) => nodes[selector.slice(1)], createElement: () => new Element() },
        });
        runInContext(readFileSync("public/scripts/companion-wiki.js", "utf8"), context);
        await vi.waitFor(() => expect(nodes.wikiStatus.textContent).toContain("not found"));
        await runInContext("loadCompanionWiki()", context);
        expect(nodes.wikiName.textContent).toBe("Auroragon");
        expect(nodes.wikiDetails.className).toBe("rarity-eternal");
        expect(nodes.wikiStats.children).toHaveLength(5);
        expect(nodes.wikiWeight.textContent).toBe("0.19607843");
        expect(nodes.wikiChance.textContent).toBe("1 in 2,941,176,470,588");
        expect(runInContext("formatOneIn(25)", context)).toBe("1 in 4");
        expect(runInContext("formatOneIn(100)", context)).toBe("1 in 1");
        expect(runInContext("formatOneIn(0)", context)).toBe("Cannot appear");
        expect(() => runInContext("formatOneIn(-1)", context)).toThrow("Invalid encounter probability");
    });
});
