import { describe, expect, test } from "vitest";
import {
    applyCompanionBonus,
    companionEncounterWeight,
    companionSelectionWeights,
    companions,
    getCompanion,
    rarityWeightMultipliers,
} from "../src/resources/companions.js";
import { Rarity } from "../src/resources/rarities.js";
import { createAdditionalCompanions } from "../src/resources/additionalCompanions.js";

describe("companion catalog", () => {
    test("provides unique creatures with valid stats, bonuses, rarities and weights", () => {
        const values = Object.values(companions);
        expect(values.length).toBe(157);
        expect(Math.max(...values.map(companion => companion.chanceWeight))).toBe(100_000_000);
        expect(Math.min(...values.map(companion => companion.chanceWeight))).toBe(1);
        expect(new Set(values.map(companion => companion.name)).size).toBe(values.length);
        expect(new Set(values.map(companion => companion.rarity))).toEqual(new Set(Object.values(Rarity)));
        for (const [key, companion] of Object.entries(companions)) {
            expect(getCompanion(key)).toBe(companion);
            expect(companion.description.length).toBeGreaterThan(0);
            expect(Number.isFinite(companion.chanceWeight)).toBe(true);
            expect(companion.chanceWeight).toBeGreaterThan(0);
            for (const stat of Object.values(companion.stats)) {
                expect(Number.isFinite(stat)).toBe(true);
                expect(stat).toBeGreaterThan(0);
            }
            const bonus = companion.bonus;
            if ("multiplier" in bonus) expect(bonus.multiplier).toBeGreaterThan(1);
            else expect(bonus.amount).toBeGreaterThan(0);
        }
        expect(getCompanion("missing")).toBeUndefined();
        expect(getCompanion("toString")).toBeUndefined();
    });

    test("adds twenty distinct companions of each rarity with varied useful bonuses", () => {
        const added = createAdditionalCompanions();
        expect(Object.keys(added)).toHaveLength(140);
        expect(new Set(Object.values(added).map(companion => companion.name)).size).toBe(140);
        for (const rarity of Object.values(Rarity)) {
            const group = Object.entries(added).filter(([, companion]) => companion.rarity === rarity);
            expect(group).toHaveLength(20);
            expect(new Set(group.map(([, companion]) => companion.bonus.type)).size).toBeGreaterThanOrEqual(5);
            expect(new Set(group.map(([, companion]) => companion.chanceWeight)).size).toBe(20);
            for (const [key, companion] of group) {
                expect(companions[key]).toEqual(companion);
                expect(companion.description.length).toBeGreaterThan(30);
                expect(companion.chanceWeight).toBeGreaterThanOrEqual(1);
                expect(Object.values(companion.stats).every(value => value > 0)).toBe(true);
            }
        }
    });

    test("applies reward bonuses only to their specified reward", () => {
        expect(applyCompanionBonus(100, "experience", companions.mossprout)).toBe(105);
        expect(applyCompanionBonus(100, "balance", companions.mossprout)).toBe(100);
        expect(applyCompanionBonus(100, "balance", companions.coinling)).toBe(105);
        expect(applyCompanionBonus(100, "experience", companions.sparkit)).toBe(104);
        expect(applyCompanionBonus(100, "balance", companions.burrowbuck)).toBe(112);
        expect(applyCompanionBonus(1, "skillPoints", companions.runowl)).toBe(2);
        expect(applyCompanionBonus(100, "experience", companions.runowl)).toBe(100);
        expect(applyCompanionBonus(100, "experience", companions.glimmerfox)).toBe(100);
        expect(applyCompanionBonus(100, "experience")).toBe(100);
        expect(applyCompanionBonus(100, "experience", companions.solmane)).toBeCloseTo(115);
        expect(applyCompanionBonus(100, "balance", companions.auroragon)).toBe(125);
    });

    test("rare encounter bonuses multiply only Rare-or-higher weights", () => {
        let total = 0, rareTotal = 0, boostedTotal = 0, boostedRareTotal = 0;
        for (const candidate of Object.values(companions)) {
            const boosted = ![Rarity.Common, Rarity.Uncommon].includes(candidate.rarity);
            const effectiveWeight = candidate.chanceWeight * rarityWeightMultipliers[candidate.rarity];
            total += effectiveWeight;
            boostedTotal += companionEncounterWeight(candidate, companions.glimmerfox);
            if (boosted) {
                rareTotal += effectiveWeight;
                boostedRareTotal += companionEncounterWeight(candidate, companions.glimmerfox);
            }
            expect(companionEncounterWeight(candidate, companions.glimmerfox))
                .toBeCloseTo(effectiveWeight * (boosted ? 1.25 : 1));
            expect(companionEncounterWeight(candidate, companions.prismoth))
                .toBeCloseTo(effectiveWeight * (boosted ? 1.5 : 1));
            expect(companionEncounterWeight(candidate)).toBe(effectiveWeight);
            expect(companionEncounterWeight(candidate, companions.mossprout)).toBe(effectiveWeight);
        }
        expect(boostedRareTotal / boostedTotal).toBeGreaterThan(rareTotal / total);
    });

    test("rarity changes the relative odds even at equal base weight", () => {
        const common = { ...companions.mossprout, chanceWeight: 500_000 };
        const eternal = { ...companions.auroragon, chanceWeight: 500_000 };
        expect(companionEncounterWeight(common)).toBe(2_500_000);
        expect(companionEncounterWeight(eternal)).toBe(100_000);
        expect(companionEncounterWeight(common) / companionEncounterWeight(eternal)).toBe(25);
        const factors = Object.values(Rarity).map(rarity => rarityWeightMultipliers[rarity]);
        for (let i = 1; i < factors.length; i++) expect(factors[i]).toBeLessThan(factors[i - 1]);
    });

    test("rarity skills stack with equipped bonuses and circulation for every rarity", () => {
        const circulation = Object.keys(companions).map(key => ({ key, quantity: "100" }));
        const baseline = companionSelectionWeights(circulation);
        const boosted = companionSelectionWeights(circulation, companions.glimmerfox, 1.25 * 1.2);
        for (let i = 0; i < baseline.length; i++) {
            const candidate = companions[baseline[i].key];
            const rare = ![Rarity.Common, Rarity.Uncommon].includes(candidate.rarity);
            expect(baseline[i].weight).toBeCloseTo(companionEncounterWeight(candidate) / 2);
            expect(boosted[i].weight).toBeCloseTo(baseline[i].weight * (rare ? 1.25 * 1.25 * 1.2 : 1));
        }
    });

    test("multiple equipped rarity bonuses multiply only rare-or-higher weights", () => {
        const baseline = companionSelectionWeights([]);
        const boosted = companionSelectionWeights([], [companions.glimmerfox, companions.prismoth]);
        for (let i = 0; i < baseline.length; i++) {
            const rarity = companions[baseline[i].key].rarity;
            const multiplier = [Rarity.Common, Rarity.Uncommon].includes(rarity) ? 1 : 1.25 * 1.5;
            expect(boosted[i].weight).toBeCloseTo(baseline[i].weight * multiplier);
        }
    });
});
