import { describe, expect, test } from "vitest";
import { housePoolPrize, MAX_HOUSE_WAGER } from "../src/houseLearnsPrize.js";

describe("House Learns pool shares", () => {
    test.each([
        [100_000_000_000n, 100n, 100_000_000n],
        [100_000_000_000n, 37_500_000_000n, 50_000_000_000n],
        [100_000_000_000n, 75_000_000_000n, 100_000_000_000n],
        [100_000_000_000n, 80_000_000_000n, 100_000_000_000n],
        [701n, 100n, 133n],
        [701n, 525n, 700n],
        [701n, 526n, 701n],
        [0n, 100n, 0n],
        [9_007_199_254_740_999_999n, 100n, 9_007_199_254_740_999n],
    ])("pays %s pool with a %s wager as %s", (pool, wager, expected) => {
        expect(housePoolPrize(pool, wager)).toBe(expected);
    });

    test("guards invalid amounts and keeps virtual chips within safe integers", () => {
        expect(() => housePoolPrize(-1n, 100n)).toThrow(RangeError);
        expect(() => housePoolPrize(100n, -1n)).toThrow(RangeError);
        expect(Number.isSafeInteger(MAX_HOUSE_WAGER * 2)).toBe(true);
        expect(Number.isSafeInteger((MAX_HOUSE_WAGER + 1) * 2)).toBe(false);
    });
});
