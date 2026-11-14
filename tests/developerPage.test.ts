import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

class Element {
    className = "";
    textContent = "";
    type = "";
    disabled = false;
    children: Element[] = [];
    attributes: Record<string, string> = {};
    handlers: Record<string, () => void> = {};
    classList = { toggle: vi.fn() };
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    getAttribute(name: string) { return this.attributes[name] ?? null; }
    addEventListener(name: string, handler: () => void) { this.handlers[name] = handler; }
}

describe("developer dashboard page", () => {
    test("renders safe log text, toggles global settings and refreshes", async () => {
        const nodes = new Map<string, Element>();
        const querySelector = (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, new Element());
            return nodes.get(selector)!;
        };
        const settings = { chance: true, rewards: false, gambling: false, lootboxes: false };
        const entry = {
            timestamp: "2026-01-01T00:00:00.000Z", topic: "chance", username: "<img src=x>",
            userId: "123", guild: "Example server", channel: "general", message: "Chance: 1/1000",
        };
        let casinoView = true;
        const fetch = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
            if (options?.method === "PUT") {
                if (url === "/api/developer/casino-view") casinoView = JSON.parse(options.body!).enabled;
                else settings.chance = JSON.parse(options.body!).enabled;
                return { ok: true, json: async () => ({}) };
            }
            return { ok: true, json: async () => ({ settings, logs: [entry], casinoView }) };
        });
        const setInterval = vi.fn();
        const context = createContext({
            document: { querySelector, createElement: () => new Element() },
            fetch, window: { setInterval }, console, Date, encodeURIComponent,
        });
        runInContext(readFileSync("public/scripts/developer.js", "utf8"), context);
        await vi.waitFor(() => expect(querySelector("#debugSettings").children).toHaveLength(4));
        expect(querySelector("#debugSettings").children[3].children[0].textContent).toBe("Lootbox chances and rewards");
        const logs = querySelector("#debugLogs").children;
        expect(logs).toHaveLength(1);
        expect(logs[0].children[1].textContent).toBe("User: <img src=x> (123) · Server: Example server · Channel: #general");
        expect(logs[0].children[2].textContent).toBe("Chance: 1/1000");
        expect(logs[0].children[1].children).toHaveLength(0);
        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
        const button = querySelector("#debugSettings").children[0].children[1];
        expect(button.attributes["aria-pressed"]).toBe("true");
        button.handlers.click();
        await vi.waitFor(() => expect(querySelector("#debugSettings").children[0].children[1].attributes["aria-pressed"]).toBe("false"));
        expect(fetch).toHaveBeenCalledWith("/api/developer/settings/chance", expect.objectContaining({
            method: "PUT", body: '{"enabled":false}',
        }));
        const casinoToggle = querySelector("#casinoViewToggle");
        expect(casinoToggle.attributes["aria-pressed"]).toBe("true");
        casinoToggle.handlers.click();
        await vi.waitFor(() => expect(casinoToggle.attributes["aria-pressed"]).toBe("false"));
        expect(querySelector("#casinoViewStatus").textContent).toBe("Casino view disabled.");
        expect(fetch).toHaveBeenCalledWith("/api/developer/casino-view", expect.objectContaining({
            method: "PUT", body: '{"enabled":false}',
        }));
    });

    test("shows a clear error if diagnostics cannot be loaded", async () => {
        const nodes = new Map<string, Element>();
        const querySelector = (selector: string) => {
            if (!nodes.has(selector)) nodes.set(selector, new Element());
            return nodes.get(selector)!;
        };
        const logger = { error: vi.fn() };
        const context = createContext({
            document: { querySelector, createElement: () => new Element() },
            fetch: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
            window: { setInterval: vi.fn() }, console: logger,
        });
        runInContext(readFileSync("public/scripts/developer.js", "utf8"), context);
        await vi.waitFor(() => expect(querySelector("#debugStatus").textContent).toContain("Could not load diagnostics"));
        expect(logger.error).toHaveBeenCalled();
    });
});
