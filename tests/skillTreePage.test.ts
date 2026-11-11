import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { skills } from "../src/resources/skills.js";

const script = readFileSync("public/scripts/skills.js", "utf8");
const catalog = [
    { key: "root", name: "Root", description: "Start here", prerequisites: [], cost: 1, effect: "experience" },
    { key: "child", name: "Child", description: "Next", prerequisites: ["root"], cost: 2, effect: "experience" },
];

function createPage(fetch: ReturnType<typeof vi.fn>, search = "") {
    const elements = Object.fromEntries(
        ["skillTree", "skillPoints", "skillTreeStatus", "retrySkillTree", "skillDetails", "skillTreeViewport", "skillTooltip",
            "skillZoomIn", "skillZoomOut", "skillZoomReset", "skillZoomLevel",
            "skillTreeOwner", "skillTreeInstructions", "skillTreeLegend", "skillBackProfile"].map((id) => [id, {
            innerHTML: "",
            textContent: "",
            disabled: false,
            scrollLeft: 0,
            scrollTop: 0,
            scrollHeight: 1000,
            clientWidth: 800,
            clientHeight: 500,
            style: { left: "", top: "" },
            classList: { add: vi.fn(), remove: vi.fn() },
            addEventListener: vi.fn(),
            setPointerCapture: vi.fn(),
            hasPointerCapture: vi.fn(() => true),
            releasePointerCapture: vi.fn(),
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
            querySelectorAll: () => [],
            querySelector: () => ({ addEventListener: vi.fn() }),
        }]),
    );
    const context = createContext({
        document: { querySelector: (selector: string) => elements[selector.slice(1)] },
        window: { innerWidth: 1000, innerHeight: 800 },
        location: { search }, URLSearchParams,
        fetch,
        encodeURIComponent,
    });
    runInContext(script, context);
    return { context, elements };
}

const response = (data: object, ok = true, status = 200) => ({
    ok, status, json: async () => data,
});

describe("skill tree page", () => {
    test("keeps the expanded skill catalog on its mapped tree and shows the casino branch", async () => {
        const keysBySkill = new Map(Object.entries(skills).map(([key, skill]) => [skill, key]));
        const fullCatalog = Object.entries(skills).map(([key, skill]) => ({
            key,
            name: skill.name,
            description: skill.description,
            cost: skill.cost,
            effect: skill.effect,
            prerequisites: skill.prerequisites.map(prerequisite => keysBySkill.get(prerequisite)),
        }));
        const fetch = vi.fn().mockResolvedValue(response({
            skills: fullCatalog,
            unlocked: [],
            skillPoints: 0,
        }));
        const { elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 0"));
        expect(elements.skillTree.innerHTML).toContain("branch-casino");
        expect(elements.skillTree.innerHTML).toContain("skill-tree-zoom-frame");
    });

    test("another player's tree is read-only and links back to their profile", async () => {
        const fetch = vi.fn().mockResolvedValue(response({
            name: "Other", skills: catalog, unlocked: ["root"], skillPoints: 99,
        }));
        const { context, elements } = createPage(fetch, "?player=another");
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 99"));
        expect(fetch).toHaveBeenCalledWith("/api/skills/player/another", { cache: "no-store" });
        expect(elements.skillTreeOwner.textContent).toBe("Other's progression (read-only)");
        expect(elements.skillTree.innerHTML).toContain("Child: Not unlocked");
        expect(elements.skillTreeInstructions.textContent).toContain("read-only");
        expect(runInContext("skillBackProfile.href", context)).toBe("/leaderboard?id=another");
        runInContext('selectSkill("child")', context);
        expect(elements.skillDetails.innerHTML).toContain("Requires all: Root");
        expect(elements.skillDetails.innerHTML).not.toContain("skill-purchase");
        await runInContext('purchaseSkill("child")', context);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    test("renders prerequisites, costs and updates the tree after a purchase", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: [], skillPoints: 3 }))
            .mockResolvedValueOnce(response({ unlocked: ["root"], skillPoints: 2 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        expect(elements.skillTree.innerHTML).toContain('data-skill="child"');
        expect(elements.skillTree.innerHTML).toContain("Child: Locked");
        expect(elements.skillTree.innerHTML).toContain("<path");
        runInContext('selectSkill("child")', context);
        expect(elements.skillDetails.innerHTML).toContain("Requires all: Root");
        expect(elements.skillDetails.innerHTML).toContain('disabled');
        runInContext('selectSkill("root")', context);
        expect(elements.skillDetails.innerHTML).toContain("Unlock for 1 point");

        await runInContext('purchaseSkill("root")', context);
        expect(fetch).toHaveBeenLastCalledWith("/api/skills/root", { method: "POST" });
        expect(elements.skillPoints.textContent).toBe("Available skill points: 2");
        expect(elements.skillDetails.innerHTML).toContain("Unlocked");
        expect(elements.skillTree.innerHTML).toContain("Child: Available");
        runInContext('selectSkill("child")', context);
        expect(elements.skillDetails.innerHTML).toContain("Unlock for 2 points");
        expect(elements.skillTreeStatus.textContent).toBe("Skill unlocked.");
    });

    test("surfaces loading errors and permits retry", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ error: "Player not found" }, false, 404))
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: [], skillPoints: 0 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillTreeStatus.textContent).toContain("Player not found"));
        expect(elements.retrySkillTree.classList.remove).toHaveBeenCalledWith("hidden");
        await runInContext("refreshSkillTree()", context);
        expect(elements.skillPoints.textContent).toBe("Available skill points: 0");
        runInContext('selectSkill("root")', context);
        expect(elements.skillDetails.innerHTML).toContain("Not enough points");
    });

    test("clears stale purchase state if refreshing after an error fails", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: [], skillPoints: 3 }))
            .mockResolvedValueOnce(response({ error: "Not enough skill points" }, false, 409))
            .mockRejectedValueOnce(new Error("Network error"));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        await runInContext('purchaseSkill("root")', context);
        expect(elements.skillTreeStatus.textContent).toContain("Not enough skill points");
        expect(elements.skillTreeStatus.textContent).toContain("Network error");
        expect(elements.skillTree.innerHTML).toBe("");
        expect(elements.retrySkillTree.classList.remove).toHaveBeenCalledWith("hidden");
    });

    test("refreshes points and unlocks when another purchase made the page stale", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: [], skillPoints: 3 }))
            .mockResolvedValueOnce(response({ error: "Skill already unlocked" }, false, 409))
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: ["root"], skillPoints: 2 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        await runInContext('purchaseSkill("root")', context);
        expect(elements.skillPoints.textContent).toBe("Available skill points: 2");
        expect(elements.skillTree.innerHTML).toContain("Child: Available");
        expect(elements.skillTreeStatus.textContent).toContain("Skill already unlocked");
    });

    test("renders every real skill and its prerequisite connection", async () => {
        const entries = Object.entries(skills);
        const realCatalog = entries.map(([key, skill]) => ({
            key, name: skill.name, description: skill.description, cost: skill.cost, effect: skill.effect,
            prerequisites: skill.prerequisites.map(prerequisite =>
                entries.find(([, candidate]) => candidate === prerequisite)?.[0]),
        }));
        const fetch = vi.fn().mockResolvedValue(response({
            skills: realCatalog, unlocked: ["experience_gain_1", "experience_multiplier_1"], skillPoints: 5,
        }));
        const { elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 5"));
        for (const skill of realCatalog) {
            expect(elements.skillTree.innerHTML).toContain(`data-skill="${skill.key}"`);
        }
        expect(elements.skillTree.innerHTML.match(/<path /g)).toHaveLength(
            realCatalog.reduce((sum, skill) => sum + skill.prerequisites.length, 0),
        );
        expect(elements.skillTree.innerHTML).toContain('class="skill-link branch-experience active"');
        expect(elements.skillTree.innerHTML).toContain('branch-experience');
        expect(elements.skillTree.innerHTML).toContain('branch-balance');
        expect(elements.skillTree.innerHTML).toContain('branch-skill');
        expect(elements.skillTree.innerHTML).toContain('branch-companionSpawn');
        expect(elements.skillTree.innerHTML).toContain('branch-companionRarity');
        for (const skill of realCatalog) {
            for (const prerequisite of skill.prerequisites) {
                expect(elements.skillTree.innerHTML).toContain(`data-from="${prerequisite}" data-to="${skill.key}"`);
            }
        }
    });

    test("shows every prerequisite and keeps cross-branch skills locked until all are owned", async () => {
        const crossCatalog = [
            ...catalog,
            { key: "other", name: "Other", description: "", prerequisites: [], cost: 1, effect: "balance" },
            { key: "cross", name: "Cross", description: "", prerequisites: ["child", "other"], cost: 2, effect: "experience" },
        ];
        const fetch = vi.fn().mockResolvedValue(response({
            skills: crossCatalog, unlocked: ["root", "child"], skillPoints: 3,
        }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        expect(elements.skillTree.innerHTML).toContain("Cross: Locked");
        expect(elements.skillTree.innerHTML.match(/data-skill="cross"/g)).toHaveLength(1);
        expect(elements.skillTree.innerHTML).toContain('data-from="child" data-to="cross"');
        expect(elements.skillTree.innerHTML).toContain('data-from="other" data-to="cross"');
        runInContext('selectSkill("cross")', context);
        expect(elements.skillDetails.innerHTML).toContain("Requires all: Child, Other");
        expect(elements.skillDetails.innerHTML).toContain("Unlock prerequisites first");
        expect(elements.skillDetails.innerHTML).toContain("disabled");
        runInContext('treeData.unlocked.push("other"); renderSkillTree();', context);
        expect(elements.skillTree.innerHTML).toContain("Cross: Available");
        expect(elements.skillDetails.innerHTML).toContain("Unlock for 2 points");
    });

    test("highlights every transitive prerequisite and edge, but not unrelated skills", async () => {
        const crossCatalog = [
            ...catalog,
            { key: "other", name: "Other", description: "", prerequisites: [], cost: 1, effect: "balance" },
            { key: "cross", name: "Cross", description: "", prerequisites: ["child", "other"], cost: 2, effect: "experience" },
            { key: "unrelated", name: "Unrelated", description: "", prerequisites: [], cost: 1, effect: "skill" },
        ];
        const fetch = vi.fn().mockResolvedValue(response({ skills: crossCatalog, unlocked: [], skillPoints: 3 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        const nodes = crossCatalog.map(skill => ({ dataset: { skill: skill.key }, classList: { toggle: vi.fn() } }));
        const links = [
            ["root", "child"], ["child", "cross"], ["other", "cross"], ["unrelated", "cross-no"],
        ].map(([from, to]) => ({ dataset: { from, to }, classList: { toggle: vi.fn() } }));
        elements.skillTree.querySelectorAll = (selector: string) =>
            selector === "[data-skill]" ? nodes : selector === ".skill-link" ? links : [];
        runInContext('hoveredSkill = "cross"; updateSkillHighlights()', context);
        for (const node of nodes) {
            expect(node.classList.toggle).toHaveBeenLastCalledWith(
                "prerequisite-highlight", node.dataset.skill !== "unrelated",
            );
        }
        links.forEach((link, index) => {
            expect(link.classList.toggle).toHaveBeenLastCalledWith("prerequisite-highlight", index < 3);
        });
        runInContext('hoveredSkill = null; selectedSkill = "child"; updateSkillHighlights()', context);
        expect(nodes.find(node => node.dataset.skill === "cross")?.classList.toggle)
            .toHaveBeenLastCalledWith("prerequisite-highlight", false);
        expect(links[0].classList.toggle).toHaveBeenLastCalledWith("prerequisite-highlight", true);
        expect(links[1].classList.toggle).toHaveBeenLastCalledWith("prerequisite-highlight", false);
    });

    test("draws every real prerequisite without crossing paths or unrelated nodes and labels", async () => {
        const entries = Object.entries(skills);
        const realCatalog = entries.map(([key, skill]) => ({
            key, name: skill.name, description: skill.description, cost: skill.cost, effect: skill.effect,
            prerequisites: skill.prerequisites.map(prerequisite =>
                entries.find(([, candidate]) => candidate === prerequisite)?.[0]),
        }));
        const fetch = vi.fn().mockResolvedValue(response({ skills: realCatalog, unlocked: [], skillPoints: 3 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        const nodes = [...elements.skillTree.innerHTML.matchAll(
            /style="left:([\d.]+)px;top:([\d.]+)px" data-skill="([^"]+)"/g,
        )].map(match => ({ x: Number(match[1]), y: Number(match[2]), key: match[3] }));
        expect(nodes).toHaveLength(realCatalog.length);
        const byKey = new Map(nodes.map(node => [node.key, node]));
        expect(nodes.every(node => node.x % 100 === 0 && (node.y - 150) % 85 === 0)).toBe(true);
        const xOffset = Math.min(...nodes.map(node => node.x));
        expect(nodes.filter(node => (node.x - xOffset) % 200 === 0 && (node.y - 150) % 170 === 0).length)
            .toBeGreaterThanOrEqual(15);
        const roots = realCatalog.filter(skill => skill.prerequisites.length === 0)
            .map(skill => byKey.get(skill.key)!);
        expect(roots).toHaveLength(3);
        const orderedRoots = [...roots].sort((a, b) => a.x - b.x);
        expect(new Set(roots.map(root => root.y)).size).toBe(1);
        const spacing = orderedRoots[1].x - orderedRoots[0].x;
        expect(orderedRoots[2].x - orderedRoots[1].x).toBe(spacing);
        expect(spacing).toBeGreaterThan(150);
        expect(spacing).toBeLessThanOrEqual(250);
        const range = (points: { x: number; y: number }[], axis: "x" | "y") => ({
            min: Math.min(...points.map(point => point[axis])),
            max: Math.max(...points.map(point => point[axis])),
        });
        const graphSizes = [...elements.skillTree.innerHTML.matchAll(/width:([\d.]+)px;height:([\d.]+)px/g)];
        expect(graphSizes).toHaveLength(2);
        const graphWidth = Number(graphSizes[1][1]), graphHeight = Number(graphSizes[1][2]);
        expect(Math.min(...nodes.map(node => node.x)) - 85).toBeGreaterThanOrEqual(0);
        expect(Math.max(...nodes.map(node => node.x)) + 85).toBeLessThan(graphWidth);
        expect(Math.min(...nodes.map(node => node.y)) - 35).toBeGreaterThanOrEqual(0);
        expect(Math.max(...nodes.map(node => node.y)) + 95).toBeLessThan(graphHeight);
        for (const axis of ["x", "y"] as const) {
            const all = range(nodes, axis);
            const width = all.max - all.min;
            const center = (all.min + all.max) / 2;
            const boundsCenter = center + (axis === "y" ? 30 : 0);
            const scroll = axis === "x" ? elements.skillTreeViewport.scrollLeft : elements.skillTreeViewport.scrollTop;
            const padding = axis === "x" ? 26 : 38;
            const viewportSize = axis === "x" ? elements.skillTreeViewport.clientWidth : elements.skillTreeViewport.clientHeight;
            const zoom = Number.parseInt(elements.skillZoomLevel.textContent) / 100;
            expect(scroll).toBeCloseTo(Math.max(0, boundsCenter * zoom + padding - viewportSize / 2));
            const extent = width + (axis === "x" ? 170 : 130);
            expect(extent * zoom).toBeLessThanOrEqual(viewportSize - 40);
        }
        type Point = { x: number; y: number };
        const crosses = (a: Point, b: Point, c: Point, d: Point) => {
            const orientation = (p: Point, q: Point, r: Point) =>
                (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
            const on = (p: Point, q: Point, r: Point) =>
                r.x >= Math.min(p.x, q.x) && r.x <= Math.max(p.x, q.x)
                && r.y >= Math.min(p.y, q.y) && r.y <= Math.max(p.y, q.y);
            const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
            const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
            return (o1 * o2 < 0 && o3 * o4 < 0)
                || (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d))
                || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
        };
        const paths = [...elements.skillTree.innerHTML.matchAll(
            /data-from="([^"]+)" data-to="([^"]+)" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/g,
        )].map(match => ({
            from: match[1], to: match[2],
            a: { x: Number(match[3]), y: Number(match[4]) },
            b: { x: Number(match[5]), y: Number(match[6]) },
        }));
        expect(paths).toHaveLength(realCatalog.reduce((sum, skill) => sum + skill.prerequisites.length, 0));
        const lengths = paths.map(path => Math.hypot(path.a.x - path.b.x, path.a.y - path.b.y));
        expect(Math.max(...lengths)).toBeLessThan(625);
        expect(lengths.reduce((sum, length) => sum + length, 0) / lengths.length).toBeLessThan(350);
        for (const [index, path] of paths.entries()) {
            expect(path.a).toEqual({ x: byKey.get(path.from)!.x, y: byKey.get(path.from)!.y });
            expect(path.b).toEqual({ x: byKey.get(path.to)!.x, y: byKey.get(path.to)!.y });
            for (const other of paths.slice(index + 1)) {
                const shared = [path.from, path.to].find(key => key === other.from || key === other.to);
                if (shared) {
                    const origin = byKey.get(shared)!;
                    const first = byKey.get(path.from === shared ? path.to : path.from)!;
                    const second = byKey.get(other.from === shared ? other.to : other.from)!;
                    const ax = first.x - origin.x, ay = first.y - origin.y;
                    const bx = second.x - origin.x, by = second.y - origin.y;
                    expect(ax * by - ay * bx !== 0 || ax * bx + ay * by <= 0).toBe(true);
                    continue;
                }
                expect(crosses(path.a, path.b, other.a, other.b), `${path.from}-${path.to} crosses ${other.from}-${other.to}`).toBe(false);
            }
            for (const node of nodes) {
                if (node.key === path.from || node.key === path.to) continue;
                const corners = [
                    { x: node.x - 75, y: node.y - 31 }, { x: node.x + 75, y: node.y - 31 },
                    { x: node.x + 75, y: node.y + 90 }, { x: node.x - 75, y: node.y + 90 },
                ];
                for (const [cornerIndex, corner] of corners.entries()) {
                    expect(crosses(path.a, path.b, corner, corners[(cornerIndex + 1) % 4]),
                        `${path.from}-${path.to} crosses ${node.key}`).toBe(false);
                }
            }
        }
        for (const [index, node] of nodes.entries()) {
            for (const other of nodes.slice(index + 1)) {
                expect(Math.abs(node.x - other.x) > 150 || Math.abs(node.y - other.y) > 121).toBe(true);
            }
        }
        elements.skillTreeViewport.clientWidth = 353;
        elements.skillTreeViewport.clientHeight = 464;
        runInContext("treePositionInitialized = false; renderSkillTree()", context);
        const mobileZoom = Number.parseInt(elements.skillZoomLevel.textContent) / 100;
        for (const axis of ["x", "y"] as const) {
            const all = range(nodes, axis);
            const size = axis === "x" ? 170 : 130;
            const viewportSize = axis === "x" ? 353 : 464;
            expect((all.max - all.min + size) * mobileZoom).toBeLessThan(viewportSize);
        }
    });

    test("keeps a non-planar catalog purchasable in a clearly labelled fallback", async () => {
        const roots = ["a", "b", "c"].map(key => ({
            key, name: key, description: "", prerequisites: [], cost: 1, effect: "experience",
        }));
        const dependents = ["d", "e", "f"].map(key => ({
            key, name: key, description: "", prerequisites: ["a", "b", "c"], cost: 1, effect: "balance",
        }));
        const fetch = vi.fn().mockResolvedValue(response({ skills: [...roots, ...dependents], unlocked: [], skillPoints: 3 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        expect(elements.skillTree.innerHTML).toContain("Unable to draw this skill catalog without overlapping paths");
        expect(elements.skillTree.innerHTML).not.toContain("<path");
        expect(elements.skillZoomIn.disabled).toBe(true);
        expect(elements.skillZoomOut.disabled).toBe(true);
        for (const skill of [...roots, ...dependents]) expect(elements.skillTree.innerHTML).toContain(`data-skill="${skill.key}"`);
        runInContext('selectSkill("d")', context);
        expect(elements.skillDetails.innerHTML).toContain("Requires all: a, b, c");
        runInContext('selectSkill("a")', context);
        expect(elements.skillDetails.innerHTML).toContain("Unlock for 1 point");
    });

    test("zooms around the pointer and viewport center, clamps limits, and keeps zoom after a purchase", async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ skills: catalog, unlocked: [], skillPoints: 3 }))
            .mockResolvedValueOnce(response({ unlocked: ["root"], skillPoints: 2 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        const frame = {
            style: { width: "", height: "" },
            getBoundingClientRect: () => ({ left: 100, top: 50 }),
        };
        const graph = { style: { transform: "" } };
        elements.skillTree.querySelector = (selector: string) =>
            selector === ".skill-tree-zoom-frame" ? frame : graph;
        const wheel = elements.skillTreeViewport.addEventListener.mock.calls.find(([type]) => type === "wheel")?.[1];
        const preventDefault = vi.fn();
        elements.skillTreeViewport.scrollLeft = 100;
        elements.skillTreeViewport.scrollTop = 100;
        wheel({ deltaY: -1, clientX: 300, clientY: 150, preventDefault });
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(elements.skillTreeViewport.scrollLeft).toBe(140);
        expect(elements.skillTreeViewport.scrollTop).toBe(120);
        expect(elements.skillZoomLevel.textContent).toBe("120%");
        expect(graph.style.transform).toBe("scale(1.2)");
        expect(Number.parseFloat(frame.style.width)).toBeGreaterThan(0);
        const browserZoom = vi.fn();
        wheel({ deltaY: -1, ctrlKey: true, clientX: 300, clientY: 150, preventDefault: browserZoom });
        expect(browserZoom).not.toHaveBeenCalled();
        expect(elements.skillZoomLevel.textContent).toBe("120%");
        await runInContext('purchaseSkill("root")', context);
        expect(elements.skillTree.innerHTML).toContain("transform:scale(1.2)");
        expect(elements.skillZoomLevel.textContent).toBe("120%");
        runInContext("zoomFromCenter(5)", context);
        expect(elements.skillZoomLevel.textContent).toBe("200%");
        expect(elements.skillZoomIn.disabled).toBe(true);
        runInContext("zoomFromCenter(0)", context);
        expect(elements.skillZoomLevel.textContent).toBe("15%");
        expect(elements.skillZoomOut.disabled).toBe(true);
        const reset = elements.skillZoomReset.addEventListener.mock.calls.find(([type]) => type === "click")?.[1];
        reset();
        expect(elements.skillZoomLevel.textContent).toBe("100%");
        expect(elements.skillZoomReset.disabled).toBe(true);
    });

    test("hover previews descriptions and prerequisites without selecting or purchasing", async () => {
        const fetch = vi.fn().mockResolvedValue(response({ skills: catalog, unlocked: [], skillPoints: 3 }));
        const { context, elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        const button = {
            dataset: { skill: "child" },
            getBoundingClientRect: () => ({ left: 100, top: 200, bottom: 250, width: 50 }),
            setAttribute: vi.fn(),
        };
        elements.skillTooltip.getBoundingClientRect = () => ({ width: 250, height: 100 });
        context.button = button;
        runInContext("showSkillTooltip(button)", context);
        expect(elements.skillTooltip.innerHTML).toContain("Next");
        expect(elements.skillTooltip.innerHTML).toContain("Requires all: Root");
        expect(elements.skillTooltip.innerHTML).toContain("Locked");
        expect(button.setAttribute).toHaveBeenCalledWith("aria-describedby", "skillTooltip");
        expect(elements.skillDetails.innerHTML).toContain("Select a node");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test("dragging pans both axes, suppresses the drag click, and supports keyboard panning", async () => {
        const fetch = vi.fn().mockResolvedValue(response({ skills: catalog, unlocked: [], skillPoints: 3 }));
        const { elements } = createPage(fetch);
        await vi.waitFor(() => expect(elements.skillPoints.textContent).toBe("Available skill points: 3"));
        const viewport = elements.skillTreeViewport;
        const handler = (name: string) => {
            const call = viewport.addEventListener.mock.calls.find(([type]) => type === name);
            if (!call) throw new Error(`Missing ${name} handler`);
            return call[1] as (event: Record<string, unknown>) => void;
        };
        viewport.scrollLeft = 100;
        viewport.scrollTop = 300;
        handler("pointerdown")({ isPrimary: true, pointerType: "mouse", button: 0, pointerId: 1, clientX: 100, clientY: 100 });
        handler("pointermove")({ pointerId: 1, clientX: 60, clientY: 150, preventDefault: vi.fn() });
        expect(viewport.scrollLeft).toBe(140);
        expect(viewport.scrollTop).toBe(250);
        expect(viewport.setPointerCapture).toHaveBeenCalledWith(1);
        handler("pointerup")({ pointerId: 1, type: "pointerup" });
        const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler("click")(click);
        expect(click.preventDefault).toHaveBeenCalled();
        expect(click.stopPropagation).toHaveBeenCalled();
        const keyboard = { target: viewport, key: "ArrowRight", preventDefault: vi.fn() };
        handler("keydown")(keyboard);
        expect(viewport.scrollLeft).toBe(240);
        expect(keyboard.preventDefault).toHaveBeenCalled();
    });
});
