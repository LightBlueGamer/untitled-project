const skillTree = document.querySelector('#skillTree');
const skillPoints = document.querySelector('#skillPoints');
const skillTreeStatus = document.querySelector('#skillTreeStatus');
const retrySkillTree = document.querySelector('#retrySkillTree');
const skillDetails = document.querySelector('#skillDetails');
const skillViewport = document.querySelector('#skillTreeViewport');
const skillTooltip = document.querySelector('#skillTooltip');
const skillZoomIn = document.querySelector('#skillZoomIn');
const skillZoomOut = document.querySelector('#skillZoomOut');
const skillZoomReset = document.querySelector('#skillZoomReset');
const skillZoomLevel = document.querySelector('#skillZoomLevel');
const skillTreeOwner = document.querySelector('#skillTreeOwner');
const skillTreeInstructions = document.querySelector('#skillTreeInstructions');
const skillTreeLegend = document.querySelector('#skillTreeLegend');
const skillBackProfile = document.querySelector('#skillBackProfile');
const viewedPlayerId = new URLSearchParams(location.search).get('player');
const readOnlyTree = Boolean(viewedPlayerId);
if (readOnlyTree) {
  skillBackProfile.href = `/leaderboard?id=${encodeURIComponent(viewedPlayerId)}`;
  skillTreeInstructions.textContent = 'This skill tree is read-only. Select a skill to see its effect and prerequisites.';
  skillTreeLegend.textContent = 'Glowing nodes are unlocked; grey nodes have not been unlocked.';
}
const minTreeZoom = 0.15;
const maxTreeZoom = 2;
const treeZoomStep = 0.2;
let treeZoom = 1;
let treeGraphSize = null;
let treeData = null;
let selectedSkill = null;
let purchasingSkill = false;
let hoveredSkill = null;
let focusedSkill = null;
let treePositionInitialized = false;
let drag = null;
let suppressDragClick = false;

const escapeSkillText = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const branchStyles = {
  experience: { label: 'Experience', icon: '✦' },
  balance: { label: 'Income', icon: '$' },
  skill: { label: 'Skill points', icon: '◆' },
  companionSpawn: { label: 'Companion appearance', icon: '✧' },
  companionRarity: { label: 'Companion rarity', icon: '✦' },
  casino: { label: 'House-game payouts', icon: '♠' },
  scavenge: { label: 'Scavenging', icon: '⌕' },
  scavengeCooldown: { label: 'Scavenging cooldown', icon: '⌛' },
  scavengeRarity: { label: 'Rare finds', icon: '◇' },
  scavengeFind: { label: 'Extra finds', icon: '✚' },
  scavengeExperience: { label: 'Scavenging XP', icon: '✦' },
  lootboxDrop: { label: 'Lootbox chance', icon: '✦' },
  lootboxRarity: { label: 'Lootbox rarity', icon: '◇' },
  lootboxReward: { label: 'Lootbox rewards', icon: '✧' },
  lootboxFind: { label: 'Lootbox treasure', icon: '◆' },
  toolSlots: { label: 'Tool mastery', icon: '⚒' }
};

// Coordinates use a shared grid; the catalog remains authoritative for prerequisites.
const skillLayout = {
  nest_egg: [4, 0], compound_interest: [6, 0],
  windfall: [4, 2], lucky_find: [6, 2],
  companion_bond: [2, 4], jackpot: [6, 4], lucky_trails: [10, 4],
  keen_senses: [2, 6], extra_income_2: [4, 6], money_multiplier_2: [6, 6], golden_breakthrough: [9, 6],
  field_notes: [3, 8], money_multiplier_1: [8, 8],
  scholars_fortune: [4, 10], experience_gain_1: [6, 10], extra_income: [8, 10], skill_mastery_1: [10, 10],
  experience_gain_2: [4, 12], momentum: [6, 12], rare_insight: [12, 12],
  experience_multiplier_1: [9, 13],
  experience_multiplier_2: [7, 14], discovery: [12, 14],
  skill_gain_1: [10, 15],
  inspiration: [6, 16], insightful_discovery: [8, 16],
  steady_study: [6, 18], deep_focus: [8, 18],
  house_edge_1: [2, 0], house_edge_2: [0, 2],
  scavenging_efficiency: [0, 10], rare_finder: [2, 12],
  extra_find: [0, 14], tool_mastery: [2, 16], scavenging_experience: [0, 18],
  scavenging_experience_2: [0, 20],
  box_hunter: [0, 8], box_fortune: [0, 6], box_treasures: [0, 4], box_recovery: [-2, 4]
};

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x)
    && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
    || (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
}

function skillLayoutIsClear(positions, edges) {
  const nodes = [...positions.entries()];
  const bounds = p => ({ left: p.x - 75, right: p.x + 75, top: p.y - 31, bottom: p.y + 90 });
  for (let i = 0; i < nodes.length; i++) {
    const box = bounds(nodes[i][1]);
    for (const [, point] of nodes.slice(i + 1)) {
      const other = bounds(point);
      if (box.left <= other.right && other.left <= box.right
        && box.top <= other.bottom && other.top <= box.bottom) return false;
    }
  }
  for (let i = 0; i < edges.length; i++) {
    const [from, to] = edges[i];
    const a = positions.get(from), b = positions.get(to);
    for (const [key, point] of nodes) {
      if (key === from || key === to) continue;
      const box = bounds(point);
      const corners = [
        { x: box.left, y: box.top }, { x: box.right, y: box.top },
        { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }
      ];
      if ((a.x >= box.left && a.x <= box.right && a.y >= box.top && a.y <= box.bottom)
        || corners.some((corner, index) => segmentsIntersect(a, b, corner, corners[(index + 1) % 4]))) return false;
    }
    for (const [otherFrom, otherTo] of edges.slice(i + 1)) {
      const shared = [from, to].find(key => key === otherFrom || key === otherTo);
      if (shared) {
        const origin = positions.get(shared);
        const first = positions.get(from === shared ? to : from);
        const second = positions.get(otherFrom === shared ? otherTo : otherFrom);
        const ax = first.x - origin.x, ay = first.y - origin.y;
        const bx = second.x - origin.x, by = second.y - origin.y;
        if (ax * by - ay * bx === 0 && ax * bx + ay * by > 0) return false;
        continue;
      }
      if (segmentsIntersect(a, b, positions.get(otherFrom), positions.get(otherTo))) return false;
    }
  }
  return true;
}

function getSkillLayout(skills) {
  const keys = new Set(skills.map(skill => skill.key));
  if (keys.size !== skills.length) throw new Error('Duplicate skill key in catalog');
  const edges = skills.flatMap(skill => skill.prerequisites.map(key => {
    if (!keys.has(key) || key === skill.key) throw new Error(`Invalid prerequisite for ${skill.name}`);
    return [key, skill.key];
  }));
  const known = skills.every(skill => Object.hasOwn(skillLayout, skill.key));
  const radius = Math.max(250, skills.length * 100);
  const positions = new Map(skills.map((skill, index) => {
    const coordinates = known ? skillLayout[skill.key] : null;
    return [skill.key, coordinates
      ? { x: coordinates[0] * 100, y: 150 + coordinates[1] * 85 }
      : { x: radius + 200 + radius * Math.cos(2 * Math.PI * index / skills.length),
        y: radius + 120 + radius * Math.sin(2 * Math.PI * index / skills.length) }];
  }));
  const minX = Math.min(...[...positions.values()].map(point => point.x));
  const shiftX = Math.max(0, 100 - minX);
  positions.forEach(point => { point.x += shiftX; });
  return { positions, edges, clear: skillLayoutIsClear(positions, edges) };
}

function skillState(skill) {
  const owned = treeData.unlocked.includes(skill.key);
  const prerequisites = skill.prerequisites.map(key => treeData.skills.find(item => item.key === key));
  const locked = prerequisites.some(item => !treeData.unlocked.includes(item.key));
  const affordable = treeData.skillPoints >= skill.cost;
  return { owned, prerequisites, locked, affordable };
}

async function loadSkillTree() {
  const url = readOnlyTree ? `/api/skills/player/${encodeURIComponent(viewedPlayerId)}` : '/api/skills';
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  treeData = data;
  skillTreeOwner.textContent = readOnlyTree ? `${data.name}'s progression (read-only)` : 'Your progression';
  if (!treeData.skills.some(skill => skill.key === selectedSkill)) selectedSkill = null;
  retrySkillTree.classList.add('hidden');
  renderSkillTree();
}

function renderSkillTree() {
  const previousLeft = skillViewport.scrollLeft;
  const previousTop = skillViewport.scrollTop;
  hideSkillTooltip();
  hoveredSkill = null;
  focusedSkill = null;
  const skillsByKey = new Map(treeData.skills.map(skill => [skill.key, skill]));
  const { positions, edges, clear } = getSkillLayout(treeData.skills);
  const points = [...positions.values()];
  const bounds = points.length ? {
    left: Math.min(...points.map(point => point.x - 85)),
    right: Math.max(...points.map(point => point.x + 85)),
    top: Math.min(...points.map(point => point.y - 35)),
    bottom: Math.max(...points.map(point => point.y + 95))
  } : null;
  const graphWidth = Math.max(400, (bounds?.right ?? 200) + 60);
  const height = Math.max(250, (bounds?.bottom ?? 150) + 60);
  const center = bounds
    ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
    : { x: graphWidth / 2, y: height / 2 };
  if (!treePositionInitialized && clear && bounds) {
    const fit = Math.min(
      1,
      (skillViewport.clientWidth - 40) / (bounds.right - bounds.left),
      (skillViewport.clientHeight - 40) / (bounds.bottom - bounds.top)
    );
    treeZoom = Math.max(minTreeZoom, Math.floor(fit * 100) / 100);
  }
  const connections = edges.map(([key, target]) => {
    const from = positions.get(key), to = positions.get(target);
    const effect = skillsByKey.get(key).effect;
    const branch = Object.hasOwn(branchStyles, effect) ? effect : 'other';
    const active = treeData.unlocked.includes(key) && treeData.unlocked.includes(target);
    return `<path class="skill-link branch-${branch}${active ? ' active' : ''}" data-from="${escapeSkillText(key)}" data-to="${escapeSkillText(target)}" d="M ${from.x} ${from.y} L ${to.x} ${to.y}" />`;
  }).join('');
  const renderNode = (skill, position) => {
    const state = skillState(skill);
    const status = state.owned ? 'Unlocked' : readOnlyTree ? 'Not unlocked' : state.locked ? 'Locked' : state.affordable ? 'Available' : 'Not enough points';
    const stateClass = state.owned ? 'owned' : readOnlyTree || state.locked ? 'locked' : state.affordable ? 'available' : 'unaffordable';
    const effect = Object.hasOwn(branchStyles, skill.effect) ? skill.effect : 'other';
    const icon = branchStyles[effect]?.icon || '✦';
    return `<button type="button" class="skill-node ${stateClass}"
      ${clear ? `style="left:${position.x}px;top:${position.y}px"` : ''} data-skill="${escapeSkillText(skill.key)}"
      aria-label="${escapeSkillText(`${skill.name}: ${status}`)}" aria-pressed="${skill.key === selectedSkill}">
      <span class="skill-node-icon" aria-hidden="true">${icon}</span>
      <span class="skill-node-name">${escapeSkillText(skill.name)}</span>
    </button>`;
  };
  const nodes = treeData.skills.map(skill => {
    const effect = Object.hasOwn(branchStyles, skill.effect) ? skill.effect : 'other';
    return `<div class="skill-branch branch-${effect}">${renderNode(skill, positions.get(skill.key))}</div>`;
  }).join('');
  treeGraphSize = nodes && clear ? { width: graphWidth, height } : null;
  skillPoints.textContent = `Available skill points: ${treeData.skillPoints.toLocaleString()}`;
  skillTree.innerHTML = !nodes ? '<p class="skill-tree-empty">No skills are available yet.</p>'
    : clear
      ? `<div class="skill-tree-zoom-frame" style="width:${graphWidth * treeZoom}px;height:${height * treeZoom}px"><div class="skill-tree-graph" style="width:${graphWidth}px;height:${height}px;transform:scale(${treeZoom})"><svg class="skill-links" viewBox="0 0 ${graphWidth} ${height}" aria-hidden="true">${connections}</svg>${nodes}</div></div>`
      : `<div class="skill-tree-fallback"><p>Unable to draw this skill catalog without overlapping paths. Select a skill to see its prerequisites.</p><div class="skill-tree-fallback-nodes">${nodes}</div></div>`;
  updateZoomControls();
  skillTree.querySelectorAll('[data-skill]').forEach(button => {
    button.addEventListener('click', () => selectSkill(button.dataset.skill));
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch' && !drag) {
        hoveredSkill = button.dataset.skill;
        updateSkillHighlights();
        showSkillTooltip(button);
      }
    });
    button.addEventListener('pointerleave', () => {
      hoveredSkill = null;
      updateSkillHighlights();
      hideSkillTooltip();
    });
    button.addEventListener('focus', () => {
      focusedSkill = button.dataset.skill;
      updateSkillHighlights();
      showSkillTooltip(button);
    });
    button.addEventListener('blur', () => {
      focusedSkill = null;
      updateSkillHighlights();
      hideSkillTooltip();
    });
  });
  skillViewport.scrollLeft = treePositionInitialized ? previousLeft : clear
    ? Math.max(0, center.x * treeZoom + 26 - skillViewport.clientWidth / 2) : 0;
  skillViewport.scrollTop = treePositionInitialized ? previousTop : clear
    ? Math.max(0, center.y * treeZoom + 38 - skillViewport.clientHeight / 2) : 0;
  treePositionInitialized = true;
  updateSkillHighlights();
  renderSkillDetails();
}

function updateZoomControls() {
  skillZoomLevel.textContent = `${Math.round(treeZoom * 100)}%`;
  skillZoomOut.disabled = !treeGraphSize || treeZoom <= minTreeZoom;
  skillZoomIn.disabled = !treeGraphSize || treeZoom >= maxTreeZoom;
  skillZoomReset.disabled = !treeGraphSize || treeZoom === 1;
}

function setTreeZoom(value, anchorX, anchorY) {
  if (!treeGraphSize) return;
  const nextZoom = Math.max(minTreeZoom, Math.min(maxTreeZoom, Math.round(value * 100) / 100));
  if (nextZoom === treeZoom) return;
  const frame = skillTree.querySelector('.skill-tree-zoom-frame');
  const graph = skillTree.querySelector('.skill-tree-graph');
  const before = frame.getBoundingClientRect();
  const ratio = nextZoom / treeZoom;
  treeZoom = nextZoom;
  frame.style.width = `${treeGraphSize.width * treeZoom}px`;
  frame.style.height = `${treeGraphSize.height * treeZoom}px`;
  graph.style.transform = `scale(${treeZoom})`;
  const after = frame.getBoundingClientRect();
  skillViewport.scrollLeft += after.left + (anchorX - before.left) * ratio - anchorX;
  skillViewport.scrollTop += after.top + (anchorY - before.top) * ratio - anchorY;
  hideSkillTooltip();
  updateZoomControls();
}

function zoomFromCenter(value) {
  const viewport = skillViewport.getBoundingClientRect();
  setTreeZoom(value, viewport.left + skillViewport.clientWidth / 2, viewport.top + skillViewport.clientHeight / 2);
}

skillZoomIn.addEventListener('click', () => zoomFromCenter(treeZoom + treeZoomStep));
skillZoomOut.addEventListener('click', () => zoomFromCenter(treeZoom - treeZoomStep));
skillZoomReset.addEventListener('click', () => zoomFromCenter(1));
skillViewport.addEventListener('wheel', event => {
  if (!treeGraphSize || drag || event.ctrlKey || event.metaKey || event.deltaY === 0) return;
  event.preventDefault();
  setTreeZoom(treeZoom + (event.deltaY < 0 ? treeZoomStep : -treeZoomStep), event.clientX, event.clientY);
}, { passive: false });

function prerequisitePath(key) {
  const skillsByKey = new Map(treeData.skills.map(skill => [skill.key, skill]));
  const nodes = new Set();
  const edges = new Set();
  const visit = current => {
    if (nodes.has(current)) return;
    const skill = skillsByKey.get(current);
    if (!skill) return;
    nodes.add(current);
    skill.prerequisites.forEach(parent => {
      edges.add(JSON.stringify([parent, current]));
      visit(parent);
    });
  };
  if (key) visit(key);
  return { nodes, edges };
}

function updateSkillHighlights() {
  if (!treeData) return;
  const { nodes, edges } = prerequisitePath(hoveredSkill || focusedSkill || selectedSkill);
  skillTree.querySelectorAll('[data-skill]').forEach(button => {
    button.classList.toggle('prerequisite-highlight', nodes.has(button.dataset.skill));
  });
  skillTree.querySelectorAll('.skill-link').forEach(path => {
    path.classList.toggle('prerequisite-highlight', edges.has(JSON.stringify([path.dataset.from, path.dataset.to])));
  });
}

function showSkillTooltip(button) {
  const skill = treeData?.skills.find(item => item.key === button.dataset.skill);
  if (!skill) return;
  const { owned, prerequisites, locked, affordable } = skillState(skill);
  const status = owned ? 'Unlocked' : readOnlyTree ? 'Not unlocked' : locked ? 'Locked' : affordable ? 'Available' : 'Not enough points';
  const names = prerequisites.map(item => item.name).join(', ');
  skillTooltip.innerHTML = `<strong>${escapeSkillText(skill.name)}</strong>
    <p>${escapeSkillText(skill.description)}</p>
    <p class="skill-cost">${escapeSkillText(status)} · Cost: ${escapeSkillText(skill.cost)} point${skill.cost === 1 ? '' : 's'}${names ? `<br>Requires all: ${escapeSkillText(names)}` : ''}</p>`;
  skillTooltip.classList.remove('hidden');
  const node = button.getBoundingClientRect();
  const tip = skillTooltip.getBoundingClientRect();
  const left = Math.max(12, Math.min(window.innerWidth - tip.width - 12, node.left + node.width / 2 - tip.width / 2));
  const above = node.top - tip.height - 10;
  const top = above >= 12 ? above : Math.min(window.innerHeight - tip.height - 12, node.bottom + 10);
  skillTooltip.style.left = `${left}px`;
  skillTooltip.style.top = `${Math.max(12, top)}px`;
  button.setAttribute('aria-describedby', 'skillTooltip');
}

function hideSkillTooltip() {
  skillTooltip.classList.add('hidden');
  skillTree.querySelectorAll('[aria-describedby="skillTooltip"]').forEach(button => {
    button.removeAttribute('aria-describedby');
  });
}

skillViewport.addEventListener('pointerdown', event => {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  suppressDragClick = false;
  drag = {
    id: event.pointerId, x: event.clientX, y: event.clientY,
    left: skillViewport.scrollLeft, top: skillViewport.scrollTop, moved: false
  };
});

skillViewport.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) >= 5) {
    drag.moved = true;
    skillViewport.setPointerCapture(event.pointerId);
    skillViewport.classList.add('dragging');
    hoveredSkill = null;
    updateSkillHighlights();
    hideSkillTooltip();
  }
  if (drag.moved) {
    skillViewport.scrollLeft = drag.left - dx;
    skillViewport.scrollTop = drag.top - dy;
    event.preventDefault();
  }
});

function endTreeDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  suppressDragClick = drag.moved && event.type === 'pointerup';
  drag = null;
  skillViewport.classList.remove('dragging');
  if (skillViewport.hasPointerCapture(event.pointerId)) skillViewport.releasePointerCapture(event.pointerId);
}

skillViewport.addEventListener('pointerup', endTreeDrag);
skillViewport.addEventListener('pointercancel', endTreeDrag);
skillViewport.addEventListener('lostpointercapture', endTreeDrag);
skillViewport.addEventListener('click', event => {
  if (suppressDragClick) {
    event.preventDefault();
    event.stopPropagation();
    suppressDragClick = false;
  }
}, true);
skillViewport.addEventListener('keydown', event => {
  if (event.target !== skillViewport) return;
  const directions = {
    ArrowLeft: [-100, 0], ArrowRight: [100, 0],
    ArrowUp: [0, -100], ArrowDown: [0, 100]
  };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  skillViewport.scrollLeft += direction[0];
  skillViewport.scrollTop += direction[1];
  hideSkillTooltip();
});
skillViewport.addEventListener('scroll', hideSkillTooltip);

function selectSkill(key) {
  selectedSkill = key;
  skillTree.querySelectorAll('[data-skill]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.skill === key));
  });
  updateSkillHighlights();
  renderSkillDetails();
}

function renderSkillDetails() {
  const skill = treeData.skills.find(item => item.key === selectedSkill);
  if (!skill) {
    skillDetails.classList.remove('hidden');
    skillDetails.innerHTML = readOnlyTree
      ? '<p class="skill-details-hint">Select a node to see its details.</p>'
      : '<p class="skill-details-hint">Select a node to see its details and unlock it.</p>';
    return;
  }
  const { owned, prerequisites, locked, affordable } = skillState(skill);
  const prerequisiteNames = prerequisites.map(item => item.name).join(', ');
  const label = owned ? 'Unlocked' : locked ? 'Unlock prerequisites first' :
    affordable ? `Unlock for ${skill.cost} point${skill.cost === 1 ? '' : 's'}` : 'Not enough points';
  const status = owned ? 'Unlocked' : readOnlyTree ? 'Not unlocked' : locked ? 'Locked' : affordable ? 'Available' : 'Not enough points';
  skillDetails.classList.remove('hidden');
  skillDetails.innerHTML = `<div>
    <span class="skill-detail-status">${escapeSkillText(status)}</span>
    <h2>${escapeSkillText(skill.name)}</h2>
    <p>${escapeSkillText(skill.description)}</p>
    <p class="skill-cost">Cost: ${escapeSkillText(skill.cost)} point${skill.cost === 1 ? '' : 's'}</p>
    ${prerequisites.length ? `<p class="skill-cost">Requires all: ${escapeSkillText(prerequisiteNames)}</p>` : ''}
  </div>
  ${readOnlyTree ? '' : `<button type="button" class="btn skill-purchase" ${owned || locked || !affordable || purchasingSkill ? 'disabled' : ''}>${escapeSkillText(label)}</button>`}`;
  if (!readOnlyTree) skillDetails.querySelector('.skill-purchase').addEventListener('click', () => purchaseSkill(skill.key));
}

async function refreshSkillTree() {
  skillTreeStatus.textContent = 'Loading skills…';
  retrySkillTree.classList.add('hidden');
  try {
    await loadSkillTree();
    skillTreeStatus.textContent = '';
  } catch (error) {
    skillTreeStatus.textContent = `Could not load the skill tree. ${error.message}`;
    retrySkillTree.classList.remove('hidden');
  }
}

async function purchaseSkill(key) {
  if (readOnlyTree || purchasingSkill) return;
  purchasingSkill = true;
  renderSkillDetails();
  skillTreeStatus.textContent = 'Unlocking skill…';
  try {
    const response = await fetch(`/api/skills/${encodeURIComponent(key)}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    treeData.unlocked = data.unlocked;
    treeData.skillPoints = data.skillPoints;
    skillTreeStatus.textContent = 'Skill unlocked.';
  } catch (error) {
    skillTreeStatus.textContent = `Could not unlock skill. ${error.message}`;
    try {
      await loadSkillTree();
    } catch (refreshError) {
      treeData = null;
      skillTree.innerHTML = '';
      treeGraphSize = null;
      updateZoomControls();
      skillDetails.innerHTML = '';
      skillDetails.classList.add('hidden');
      skillPoints.textContent = '';
      skillTreeStatus.textContent += ` Could not refresh: ${refreshError.message}`;
      retrySkillTree.classList.remove('hidden');
    }
  } finally {
    purchasingSkill = false;
    if (treeData) {
      renderSkillTree();
      const selectedButton = Array.from(skillTree.querySelectorAll('[data-skill]'))
        .find(button => button.dataset.skill === selectedSkill);
      selectedButton?.focus();
    }
  }
}

retrySkillTree.addEventListener('click', refreshSkillTree);
void refreshSkillTree();
