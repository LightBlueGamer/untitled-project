import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { afterEach, describe, expect, test, vi } from "vitest";

function setup(reduced = false) {
    const sound = vi.fn();
    const visible = vi.fn().mockReturnValue(true);
    const window = {
        setTimeout, clearTimeout,
        matchMedia: () => ({ matches: reduced }),
    };
    const context = createContext({ window, Date });
    runInContext(readFileSync("public/scripts/pokerCards.js", "utf8"), context);
    const dealer = context.window.pokerCards.dealer(sound, visible);
    const card = () => ({ classList: { add: vi.fn() }, style: {} as Record<string, string> });
    return { dealer, sound, visible, card };
}

afterEach(() => vi.useRealTimers());

describe("poker deal animation", () => {
    test("deals hole cards in rounds, then flops and runs out the board with spaced sounds", () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        const { dealer, sound, card } = setup();
        dealer.update(1, 0, ["bot", "player"], true);
        const first = card();
        const secondRound = card();
        dealer.decorate(first, "hole:bot:0");
        dealer.decorate(secondRound, "hole:player:1");
        expect(first.style.animationDelay).toBe("0ms");
        expect(secondRound.style.animationDelay).toBe("390ms");
        dealer.update(1, 5, ["bot", "player"]);
        const flop = card();
        const turn = card();
        const river = card();
        dealer.decorate(flop, "board:0");
        dealer.decorate(turn, "board:3");
        dealer.decorate(river, "board:4");
        expect(flop.style.animationDelay).toBe("520ms");
        expect(turn.style.animationDelay).toBe("1130ms");
        expect(river.style.animationDelay).toBe("1480ms");
        vi.advanceTimersByTime(1480);
        expect(sound).toHaveBeenCalledTimes(9);
    });

    test("resumes without replay, ignores duplicate updates, and preserves animation across rerenders", () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        const { dealer, sound, card } = setup();
        dealer.update(3, 3, ["one", "two"]);
        vi.runAllTimers();
        expect(sound).not.toHaveBeenCalled();
        dealer.update(3, 4, ["one", "two"]);
        dealer.update(3, 4, ["one", "two"]);
        const first = card();
        dealer.decorate(first, "board:3");
        expect(first.style.animationDelay).toBe("0ms");
        vi.advanceTimersByTime(100);
        const rerender = card();
        dealer.decorate(rerender, "board:3");
        expect(rerender.style.animationDelay).toBe("-100ms");
        expect(sound).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(300);
        expect(dealer.decorate(card(), "board:3").style.animationDelay).toBeUndefined();
    });

    test("cancels old-hand sounds and never plays while hidden", () => {
        vi.useFakeTimers();
        const { dealer, sound, visible } = setup();
        dealer.update(1, 0, ["one", "two"], true);
        dealer.update(2, 0, ["one", "two"]);
        visible.mockReturnValue(false);
        vi.runAllTimers();
        expect(sound).not.toHaveBeenCalled();
        visible.mockReturnValue(true);
        dealer.update(3, 0, ["one", "two"]);
        dealer.reset();
        vi.runAllTimers();
        expect(sound).not.toHaveBeenCalled();
    });

    test("reduced motion displays cards immediately with one sound per transition", () => {
        vi.useFakeTimers();
        const { dealer, sound, card } = setup(true);
        dealer.update(1, 0, ["one", "two"], true);
        dealer.update(1, 3, ["one", "two"]);
        dealer.update(1, 3, ["one", "two"]);
        expect(sound).toHaveBeenCalledTimes(2);
        expect(dealer.decorate(card(), "board:0").style.animationDelay).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });
});
