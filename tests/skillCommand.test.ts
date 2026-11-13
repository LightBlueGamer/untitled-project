import { afterEach, describe, expect, test, vi } from "vitest";
import type { ButtonInteraction, ChatInputCommandInteraction } from "discord.js";

vi.mock("../src/database.js", () => ({ getPool: vi.fn(), getCache: vi.fn() }));
vi.mock("../src/skillStorage.js", () => ({ unlockSkill: vi.fn() }));

import Player from "../src/classes/Player.js";
import { availableSkills, skillPrerequisiteKeys, skills } from "../src/resources/skills.js";
import { unlockSkill } from "../src/skillStorage.js";
import command, { handleSkillButton, skillList } from "../src/bot/commands/skills.js";
import buttonEvent from "../src/bot/events/buttonInteraction.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(unlockSkill).mockReset();
});

function button(customId: string, userId = "123") {
    return {
        customId, user: { id: userId }, reply: vi.fn(), deferUpdate: vi.fn(), editReply: vi.fn(),
    } as unknown as ButtonInteraction;
}

describe("skills command", () => {
    test("shows prerequisite-ready skills even when unaffordable, within Discord component limits", () => {
        const player = new Player("Test", "123", { skillPoints: 0, skills: [
            "experience_gain_1", "experience_gain_2", "extra_income", "extra_income_2", "skill_mastery_1",
        ] });
        const available = availableSkills(player.skills);
        expect(available.length).toBeGreaterThan(5);
        expect(available.some(([key]) => key === "experience_gain_2")).toBe(false);
        expect(available.some(([key]) => key === "scholars_fortune")).toBe(true);
        const pages = Math.ceil(available.length / 5);
        const descriptions: string[] = [];
        for (let page = 0; page < pages; page++) {
            const result = skillList(player, page);
            const embed = result.embeds[0].toJSON();
            expect(embed.description!.length).toBeLessThanOrEqual(4096);
            expect(result.components.length).toBeLessThanOrEqual(5);
            for (const row of result.components) {
                const buttons = row.toJSON().components;
                expect(buttons.length).toBeLessThanOrEqual(5);
                for (const item of buttons) {
                    if ("custom_id" in item) expect(item.custom_id.length).toBeLessThanOrEqual(100);
                    if ("label" in item && item.label) expect(item.label.length).toBeLessThanOrEqual(80);
                }
            }
            descriptions.push(embed.description!);
        }
        for (const [, skill] of available) {
            expect(descriptions.join("\n")).toContain(skill.name);
            expect(descriptions.join("\n")).toContain(skill.description);
        }
        expect(descriptions.join("\n")).toContain("Not enough points");
        expect(skillList(player, 999).embeds[0].data.footer?.text).toContain(`Page ${pages} of ${pages}`);
        const all = new Player("Test", "123", { skills: Object.keys(skills) });
        expect(skillList(all, 0).embeds[0].data.description).toBe("No skills are currently available to unlock.");
    });

    test("defers an ephemeral command and loads the player", async () => {
        const player = new Player("Test", "123");
        vi.spyOn(Player, "get").mockResolvedValue(player);
        const interaction = { user: { id: "123" }, client: {}, deferReply: vi.fn(), editReply: vi.fn() } as unknown as ChatInputCommandInteraction;
        await command.execute(interaction);
        expect(interaction.deferReply).toHaveBeenCalledOnce();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        expect(unlockSkill).not.toHaveBeenCalled();
    });

    test("every skill fits Discord limits when it becomes available", () => {
        for (const [key, skill] of Object.entries(skills)) {
            const player = new Player("Test", "12345678901234567890", {
                skills: skillPrerequisiteKeys(key), skillPoints: 0,
            });
            const available = availableSkills(player.skills);
            const index = available.findIndex(([candidate]) => candidate === key);
            expect(index).toBeGreaterThanOrEqual(0);
            const result = skillList(player, Math.floor(index / 5));
            const description = result.embeds[0].toJSON().description!;
            expect(description).toContain(skill.description);
            expect(description.length).toBeLessThanOrEqual(4096);
            for (const row of result.components) {
                for (const item of row.toJSON().components) {
                    if ("custom_id" in item) expect(item.custom_id.length).toBeLessThanOrEqual(100);
                    if ("label" in item && item.label) expect(item.label.length).toBeLessThanOrEqual(80);
                }
            }
        }
    });

    test("rejects foreign and malformed buttons without reading or mutating player data", async () => {
        const find = vi.spyOn(Player, "findById");
        for (const interaction of [button("skills:select:123:0:experience_gain_1:0", "456"), button("skills:confirm:123:0:toString:0")]) {
            await handleSkillButton(interaction);
            expect(interaction.reply).toHaveBeenCalledOnce();
        }
        expect(find).not.toHaveBeenCalled();
        expect(unlockSkill).not.toHaveBeenCalled();
    });

    test("selection asks for confirmation without spending, including when unaffordable; cancel only returns to the list", async () => {
        const player = new Player("Test", "123", { skillPoints: 0 });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        const selection = button("skills:select:123:0:experience_gain_1:0");
        await handleSkillButton(selection);
        const payload = vi.mocked(selection.editReply).mock.calls[0][0];
        expect(payload).toEqual(expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) }));
        if (typeof payload !== "object" || !payload || !("embeds" in payload)) throw new Error("Missing confirmation");
        expect(JSON.stringify(payload.embeds)).toContain("not have enough points");
        expect(JSON.stringify(payload.components)).toContain("skills:confirm:123:0:experience_gain_1:0");
        const cancel = button("skills:cancel:123:0:experience_gain_1:0");
        await handleSkillButton(cancel);
        expect(cancel.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: "Unlock cancelled." }));
        expect(unlockSkill).not.toHaveBeenCalled();
    });

    test("confirmation uses shared unlock and reports refreshed success and errors", async () => {
        const player = new Player("Test", "123", { skillPoints: 2 });
        vi.spyOn(Player, "findById").mockResolvedValue(player);
        vi.mocked(unlockSkill).mockResolvedValueOnce({ status: "unlocked", skills: ["experience_gain_1"], skillPoints: 1 })
            .mockResolvedValueOnce({ status: "already-unlocked" }).mockResolvedValueOnce({ status: "insufficient-points" })
            .mockResolvedValueOnce({ status: "stale" }).mockResolvedValueOnce({ status: "prerequisites" });
        for (const message of ["Unlocked", "already unlocked", "not have enough", "prestige changed", "prerequisites"]) {
            const interaction = button("skills:confirm:123:0:experience_gain_1:0");
            await handleSkillButton(interaction);
            expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(message) }));
        }
        expect(unlockSkill).toHaveBeenCalledWith("123", "experience_gain_1", 0);
    });

    test("rejects stale selections, handles missing players and clamps refreshed pagination", async () => {
        const player = new Player("Test", "123", { skills: ["experience_gain_1"], prestige: 1 });
        const find = vi.spyOn(Player, "findById").mockResolvedValue(player);
        const select = button("skills:select:123:0:experience_gain_1:0");
        await handleSkillButton(select);
        expect(select.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("no longer available") }));
        const next = button("skills:next:123:999:-:0");
        await handleSkillButton(next);
        expect(next.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: expect.any(Array) }));
        find.mockResolvedValue(null);
        const missing = button("skills:confirm:123:0:experience_gain_1:0");
        await handleSkillButton(missing);
        expect(missing.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("no longer exists") }));
        expect(unlockSkill).not.toHaveBeenCalled();
    });

    test("dispatcher reports errors after deferring without claiming the unlock failed", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(Player, "findById").mockRejectedValue(new Error("Database unavailable"));
        const interaction = button("skills:confirm:123:0:experience_gain_1:0");
        Object.assign(interaction, { deferred: true, client: {} });
        await buttonEvent.execute(interaction);
        expect(log).toHaveBeenCalledOnce();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining("may have succeeded"), embeds: [], components: [],
        }));
    });
});
