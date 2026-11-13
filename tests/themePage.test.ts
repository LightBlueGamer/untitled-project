import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

const script = readFileSync("public/scripts/theme.js", "utf8");

function createTheme(saved: string | null = null) {
    const root = { dataset: { theme: "" } };
    const button = { textContent: "", setAttribute: vi.fn() };
    const frame = { contentWindow: { postMessage: vi.fn() } };
    const listeners = new Map<string, (event: { key?: string | null; newValue?: string | null; origin?: string; source?: object; data?: object }) => void>();
    const storage = { getItem: vi.fn(() => saved), setItem: vi.fn() };
    const parent = {};
    const window = { addEventListener: (type: string, callback: typeof listeners extends Map<string, infer T> ? T : never) => listeners.set(type, callback), parent };
    const context = createContext({
        document: { documentElement: root, querySelector: () => button, querySelectorAll: () => [frame] },
        window, location: { origin: "https://ledger.example" }, localStorage: storage, console,
    });
    runInContext(script, context);
    return { root, button, frame, listeners, storage, parent, context };
}

describe("website theme", () => {
    test("defaults to dark and persists the toggle, including embedded frames", () => {
        const { root, button, frame, storage, context } = createTheme();
        expect(root.dataset.theme).toBe("dark");
        runInContext("window.ledgerTheme.toggle()", context);
        expect(root.dataset.theme).toBe("light");
        expect(button.textContent).toBe("☾ Dark");
        expect(button.setAttribute).toHaveBeenLastCalledWith("aria-label", "Switch to dark theme");
        expect(storage.setItem).toHaveBeenCalledWith("ledger-theme", "light");
        expect(frame.contentWindow.postMessage).toHaveBeenCalledWith(
            { type: "ledger-theme", theme: "light" }, "https://ledger.example",
        );
        runInContext("window.ledgerTheme.toggle()", context);
        expect(root.dataset.theme).toBe("dark");
    });

    test("restores and synchronizes the theme without trusting unrelated messages", () => {
        const { root, listeners, parent } = createTheme("light");
        expect(root.dataset.theme).toBe("light");
        listeners.get("storage")?.({ key: "ledger-theme", newValue: "dark" });
        expect(root.dataset.theme).toBe("dark");
        listeners.get("message")?.({ origin: "https://other.example", source: parent, data: { type: "ledger-theme", theme: "light" } });
        expect(root.dataset.theme).toBe("dark");
        listeners.get("message")?.({ origin: "https://ledger.example", source: parent, data: { type: "ledger-theme", theme: "light" } });
        expect(root.dataset.theme).toBe("light");
        listeners.get("storage")?.({ key: null, newValue: null });
        expect(root.dataset.theme).toBe("dark");
    });

    test("loads the theme before the stylesheet on every page", () => {
        const pages = ["index", "leaderboard", "skills", "companions", "companion", "items", "item", "casino", "wiki"]
            .map(name => `public/${name}.html`).concat("private/developer.html");
        for (const page of pages) {
            const html = readFileSync(page, "utf8");
            expect(html.indexOf('src="/scripts/theme.js"')).toBeGreaterThan(-1);
            expect(html.indexOf('src="/scripts/theme.js"')).toBeLessThan(html.indexOf('href="/styles/main.css"'));
        }
    });

    test("keeps the active theme usable if browser storage is unavailable", () => {
        const { root, context } = createTheme();
        context.localStorage.setItem.mockImplementation(() => { throw new Error("storage blocked"); });
        context.console = { warn: vi.fn() };
        runInContext("window.ledgerTheme.toggle()", context);
        expect(root.dataset.theme).toBe("light");
        expect(context.console.warn).toHaveBeenCalledOnce();
    });
});
