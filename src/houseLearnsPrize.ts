export const MAX_HOUSE_WAGER = Math.floor(Number.MAX_SAFE_INTEGER / 2);

export function housePoolPrize(pool: bigint, wager: bigint): bigint {
    if (pool < 0n || wager < 0n) throw new RangeError("Pool and wager must be non-negative.");
    const proportional = wager * 4n / 3n;
    const minimum = pool / 1000n;
    const share = proportional > minimum ? proportional : minimum;
    return share < pool ? share : pool;
}
