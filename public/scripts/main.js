const API_BASE = '/api/players';
const $ = s => document.querySelector(s);
let allPlayers = [];
let currentPage = 1;
let currentUser = null;
let profileId = null;
let salePending = false;
let profileTab = 'overview';
let skillFrameProfile = null;
const profileTabs = ['overview', 'companions', 'items', 'boosts', 'skills', 'settings'];
let boostRequest = 0;
let boostExpiryTimer = null;

window.addEventListener('message', event => {
  const frame = $('#profileSkillFrame');
  if (event.origin !== location.origin || event.source !== frame.contentWindow
    || event.data?.type !== 'skill-tree-height'
    || !Number.isFinite(event.data.height) || event.data.height <= 0) return;
  frame.style.height = `${Math.ceil(event.data.height)}px`;
});

$('#profileSkillFrame').addEventListener('load', () => {
  $('#profileSkillFrame').contentWindow?.postMessage(
    { type: 'ledger-theme', theme: document.documentElement.dataset.theme }, location.origin
  );
});

let PLAYERS_PER_PAGE = 10;

let sortState = {
  key: 'prestige',
  direction: 'desc'
};

const SORT_STORAGE_KEY = 'ledger-sort-preference';
const SORT_KEYS = ['prestige', 'balance'];
const SORT_DIRECTIONS = ['asc', 'desc'];
const SORT_ORDERS = {
  prestige: ['prestige', 'level', 'experience', 'balance'],
  balance: ['balance', 'prestige', 'level', 'experience']
};

function restoreSortState() {
  try {
    const savedPreference = localStorage.getItem(SORT_STORAGE_KEY);

    if (!savedPreference) {
      return;
    }

    const preference = JSON.parse(savedPreference);
    if (
      !preference ||
      !SORT_KEYS.includes(preference.key) ||
      !SORT_DIRECTIONS.includes(preference.direction)
    ) {
      console.warn('Ignoring invalid saved ledger sorting preference.');
      return;
    }

    sortState = {
      key: preference.key,
      direction: preference.direction
    };
  } catch (error) {
    console.error('Could not restore the saved ledger sorting preference:', error);
  }
}

function saveSortState() {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sortState));
  } catch (error) {
    console.error('Could not save the ledger sorting preference:', error);
  }
}

restoreSortState();

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));
const fmt = value => typeof value === 'number' ? value.toLocaleString() : esc(value);

function showError(message) {
  $('#error').textContent = message;
  $('#error').classList.remove('hidden');
}

function renderPlayers(adjustPageSize = true) {
  const query = $('#search').value.trim().toLowerCase();

  const sortedPlayers = [...allPlayers].sort(comparePlayers);
  const ranksByPlayerId = new Map(
    sortedPlayers.map((player, index) => [
      String(player.id),
      sortState.direction === 'asc'
        ? sortedPlayers.length - index
        : index + 1
    ])
  );
  const filteredPlayers = sortedPlayers
    .filter(player => {
      const name = String(player.name ?? '').toLowerCase();
      const id = String(player.id ?? '');

      return name.includes(query) || id.includes(query);
    });

  const currentUserIndex = currentUser
    ? filteredPlayers.findIndex(
      player => String(player.id) === String(currentUser.id)
    )
    : -1;
  if (currentUserIndex > 0) {
    filteredPlayers.unshift(filteredPlayers.splice(currentUserIndex, 1)[0]);
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPlayers.length / PLAYERS_PER_PAGE)
  );

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const startIndex = (currentPage - 1) * PLAYERS_PER_PAGE;

  const visiblePlayers = filteredPlayers.slice(
    startIndex,
    startIndex + PLAYERS_PER_PAGE
  );

  $('#playersBody').innerHTML = visiblePlayers
    .map(player => {
      const isCurrentUser = currentUser?.id === player.id;
      return `
      <tr${isCurrentUser ? ' id="current-player-row" class="current-player"' : ''}>
        <td class="rank">#${ranksByPlayerId.get(String(player.id))}</td>
        <td class="name">
          ${esc(player.name || 'Unknown')}
          ${isCurrentUser ? '<span class="you-badge">You</span>' : ''}
        </td>

        <td class="num">
          ${fmt(player.prestige ?? 0)}
        </td>

        <td class="num">
          ${fmt(player.level ?? 0)}
        </td>

        <td class="num">
          ${fmt(player.experience ?? 0)}
        </td>

        <td class="num">
          $${Number(player.balance ?? 0).toLocaleString()}
        </td>

        <td>
          <a
            class="btn"
            href="/leaderboard?id=${encodeURIComponent(player.id)}"
          >
            View profile
          </a>
        </td>
      </tr>
    `;
    })
    .join('');

  $('#empty').classList.toggle(
    'hidden',
    filteredPlayers.length !== 0
  );

  $('#status').textContent =
    `${filteredPlayers.length} adventurer${
      filteredPlayers.length === 1 ? '' : 's'
    } recorded`;

  renderPagination(totalPages, filteredPlayers.length);
  updateSortIndicators();

  if (adjustPageSize) {
    fitPageSizeToViewport(filteredPlayers.length);
  }
}

function fitPageSizeToViewport(totalPlayers) {
  const firstRow = $('#playersBody').querySelector('tr');
  if (!firstRow || totalPlayers === 0) {
    return;
  }

  const rowHeight = Math.max(
    ...Array.from($('#playersBody').querySelectorAll('tr'), row =>
      row.getBoundingClientRect().height
    )
  );
  const pagination = $('#pagination');
  const paginationHeight = pagination.classList.contains('hidden')
    ? 0
    : pagination.getBoundingClientRect().height;
  const wrap = document.querySelector('.wrap');
  const bottomPadding = Number.parseFloat(
    getComputedStyle(wrap).paddingBottom
  ) || 0;
  const availableBottom = window.innerHeight - paginationHeight - bottomPadding;
  const availableHeight = Math.max(
    rowHeight,
    availableBottom - firstRow.getBoundingClientRect().top
  );
  const fittedPageSize = Math.min(
    totalPlayers,
    Math.max(1, Math.floor(availableHeight / rowHeight))
  );

  if (fittedPageSize !== PLAYERS_PER_PAGE) {
    PLAYERS_PER_PAGE = fittedPageSize;
    currentPage = Math.min(
      currentPage,
      Math.max(1, Math.ceil(totalPlayers / PLAYERS_PER_PAGE))
    );
    renderPlayers(false);
  }
}

function comparePlayers(a, b) {
  const sortOrder = SORT_ORDERS[sortState.key];

  for (const key of sortOrder) {
    const aValue = Number(a[key] ?? 0);
    const bValue = Number(b[key] ?? 0);
    const difference = sortState.direction === 'asc'
      ? aValue - bValue
      : bValue - aValue;

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

async function loadPlayers(fresh = false) {
  try {
    const r = fresh ? await fetch(API_BASE, { cache: 'no-store' }) : await fetch(API_BASE);
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    const data = await r.json();
    allPlayers = Array.isArray(data) ? data : (data.players ?? []);
    renderPlayers();
  } catch (e) {
    showError(`Could not load the ledger. ${e.message}`);
    $('#status').textContent = 'The records could not be summoned.';
  }
}

function statGroup(title, icon, stats) {
  return `<section class="overview-group">
    <h4><span class="overview-icon" aria-hidden="true">${icon}</span>${title}</h4>
    <dl>${stats.map(([label, value, symbol]) => `<div><dt><span class="overview-stat-icon" aria-hidden="true">${symbol}</span>${label}</dt><dd>${fmt(value)}</dd></div>`).join('')}</dl>
  </section>`;
}

function selectProfileTab(tab, focus = false) {
  if (!profileTabs.includes(tab) || (tab === 'settings' && currentUser?.id !== profileId)) return;
  const previous = profileTab;
  profileTab = tab;
  for (const name of profileTabs) {
    const active = name === tab;
    const button = $(`#profileTab-${name}`);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    $(`#profilePanel-${name}`).classList.toggle('hidden', !active);
  }
  if (focus) $(`#profileTab-${tab}`).focus();
  if (tab === 'boosts' && profileId) void loadProfileBoosts(profileId);
  if (tab === 'skills' && skillFrameProfile !== profileId) {
    const tree = currentUser?.id === profileId
      ? '/skills?embed=1'
      : `/skills?embed=1&player=${encodeURIComponent(profileId)}`;
    $('#profileSkillFrame').src = tree;
    skillFrameProfile = profileId;
  }
  if (previous === 'skills' && tab !== 'skills' && profileId) {
    void loadProfile(profileId, true);
  }
}

async function loadProfile(id, fresh = false) {
  if (profileId !== id) {
    boostRequest++;
    window.clearTimeout(boostExpiryTimer);
    $('#profileBoosts').textContent = 'Open this tab to load active boosts.';
    skillFrameProfile = null;
    $('#profileSkillFrame').src = 'about:blank';
    profileTab = 'overview';
    selectProfileTab('overview');
  }
  profileId = id;
  $('#profileTab-settings').classList.add('hidden');
  $('#openSkillTree').classList.add('hidden');
  $('#profileCompanions').textContent = 'Loading companions…';
  $('#profileItems').textContent = 'Loading inventory…';
  $('#profileBackpack').textContent = '';
  $('#profileLootboxes').textContent = '';
  $('#profileEquippedTools').textContent = '';
  $('#profileItemBonuses').textContent = '';
  $('#profileSaleStatus').textContent = '';
  $('#profileNameForm').classList.add('hidden');
  $('#profileNameStatus').textContent = '';
  try {
    const url = `${API_BASE}/${encodeURIComponent(id)}`;
    const r = fresh ? await fetch(url, { cache: 'no-store' }) : await fetch(url);
    if (!r.ok) throw new Error(r.status === 404 ? 'Player not found' : `Request failed (${r.status})`);
    const p = await r.json();
    if (profileId !== id) return;
    $('#profileName').textContent = p.name || 'Unknown adventurer';
    $('#avatar').textContent = (p.name || '?').charAt(0).toUpperCase();
    const avatar = $('#profileAvatar');
    const hasAvatar = Boolean(p.discord?.avatarUrl);
    avatar.classList.toggle('hidden', !hasAvatar);
    $('#avatar').classList.toggle('hidden', hasAvatar);
    if (hasAvatar) avatar.src = p.discord.avatarUrl;
    const username = p.discord?.username || (currentUser?.id === p.id ? currentUser.username : null);
    $('#profileUsername').textContent = username
      ? `@${username}`
      : 'Discord profile unavailable';
    const requiredXP = Number(p.requiredXP) || 0;
    const experience = Number(p.experience) || 0;
    const progress = requiredXP > 0 ? Math.min(100, Math.max(0, experience / requiredXP * 100)) : 0;
    $('#profileProgressLevel').textContent = `Prestige ${Number(p.prestige ?? 0).toLocaleString()} · Level ${Number(p.level ?? 1).toLocaleString()}`;
    $('#profileProgressText').textContent = `${experience.toLocaleString()} / ${requiredXP.toLocaleString()} XP`;
    $('#profileProgressFill').style.width = `${progress}%`;
    $('#profileProgress').setAttribute('aria-valuenow', String(Math.round(progress)));
    const globalRank = [...allPlayers]
      .sort(compareGlobalRank)
      .findIndex(player => String(player.id) === String(p.id)) + 1;

    $('#profileRank').textContent = globalRank
      ? `Leaderboard rank #${globalRank}`
      : 'Unranked';
    if (profileId !== id) return;
    $('#statGrid').innerHTML = [
      statGroup('Resources', '◆', [
        ['Balance', `$${Number(p.balance ?? 0).toLocaleString()}`, '◈'],
        ['Skill points', p.skillPoints ?? 0, '✦'],
        ['Companion slots', p.companionSlots ?? 1, '♧'],
        ['Tool slots', p.toolSlots ?? 1, '⚒']
      ]),
      statGroup('Rewards', '✦', [
        ['Experience multiplier', `${p.experienceMultiplier ?? 1}×`, '✦'],
        ['Balance multiplier', `${p.balanceMultiplier ?? 1}×`, '◈'],
        ['Prestige bonus XP', `+${p.prestigeExperienceFlat ?? 0}`, '✧'],
        ['Prestige bonus money', `+$${p.prestigeBalanceFlat ?? 0}`, '♛']
      ]),
      statGroup('Companion bonuses', '✧', [
        ['Prestige appearance multiplier', `${Number(p.prestigeCompanionSpawnMultiplier ?? 1).toLocaleString()}×`, '♧'],
        ['Prestige rarity multiplier', `${Number(p.prestigeCompanionRarityMultiplier ?? 1).toLocaleString()}×`, '◇']
      ]),
      statGroup('Scavenging bonuses', '⌕', [
        ['Scavenge item bonus', `${Number(p.scavengeWeightMultiplier ?? 1).toLocaleString()}×`, '⌕'],
        ['Rare-find bonus', `${Number(p.scavengeRarityMultiplier ?? 1).toLocaleString()}×`, '◇'],
        ['Extra item chance', `${Math.round(Number(p.scavengeExtraFindChance ?? 0) * 100)}%`, '✚']
      ])
    ].join('');
    const ownProfile = currentUser?.id === p.id;
    if (ownProfile) {
      $('#profileTab-settings').classList.remove('hidden');
      $('#profileNameInput').value = p.name || '';
      $('#profileNameForm').classList.remove('hidden');
    }
    $('#openSkillTree').href = ownProfile ? '/skills' : `/skills?player=${encodeURIComponent(p.id)}`;
    $('#openSkillTree').textContent = ownProfile ? 'Open skill tree' : 'View skill tree';
    $('#openSkillTree').classList.remove('hidden');
    await loadProfileCompanions(id);
    await loadProfileItems(id);
  } catch (e) {
    if (profileId === id) {
      $('#statGrid').innerHTML = `<div class="error wide">${esc(e.message)}</div>`;
      $('#profileCompanions').textContent = 'Could not load companions because the profile could not be loaded.';
      $('#profileItems').textContent = 'Could not load inventory because the profile could not be loaded.';
      $('#profileBoosts').textContent = 'Could not load boosts because the profile could not be loaded.';
    }
  }
}

async function saveProfileName(event) {
  event.preventDefault();
  if (!currentUser || profileId !== currentUser.id) return;
  const id = profileId;
  const button = $('#saveProfileName');
  button.disabled = true;
  $('#profileNameStatus').textContent = 'Saving…';
  try {
    const response = await fetch(`${API_BASE}/me/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ name: $('#profileNameInput').value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    const player = allPlayers.find(item => String(item.id) === String(id));
    if (player) player.name = data.name;
    if (profileId === id) {
      $('#profileName').textContent = data.name;
      $('#avatar').textContent = data.name.charAt(0).toUpperCase();
      $('#profileNameInput').value = data.name;
      $('#profileNameStatus').textContent = 'Name saved.';
    }
  } catch (error) {
    if (profileId === id) $('#profileNameStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadProfileItems(id) {
  try {
    const response = await fetch(`/api/items/player/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    if (profileId !== id) return;
    $('#profileBackpack').textContent = `${data.backpack.name}: ${data.backpack.used}/${data.backpack.capacity} slots used`;
    $('#profileLootboxes').textContent = `Lootboxes: ${data.lootboxes.boxes} · Unused lootbox boosts: ${data.lootboxes.boosts}`;
    $('#profileEquippedTools').textContent = `Equipped tools (${data.equippedTools.length}/${data.toolSlots}): ${data.equippedTools.map(tool => tool.name).join(', ') || 'None'}`;
    $('#profileItemBonuses').textContent = 'See the Boosts tab for active temporary effects.';
    $('#profileItems').innerHTML = data.items.length
      ? `<ul class="profile-collection-list">${data.items.map(item => {
        const name = esc(item.name);
        const rarity = String(item.rarity ?? '').toLowerCase();
        const sellForm = currentUser?.id === id && Number.isSafeInteger(item.price) && item.price > 0
          ? `<form class="profile-sell-form" data-item="${esc(item.key)}">
              <label>Quantity <input type="number" name="quantity" min="1" max="${item.quantity}" step="1" value="1" required></label>
              <button type="submit" class="btn"${salePending ? ' disabled' : ''}>Sell for $${item.price.toLocaleString()} each</button>
            </form>`
          : '';
        return `<li class="profile-collection-card rarity-${/^(common|uncommon|rare|epic|legendary|mythic|eternal)$/.test(rarity) ? rarity : 'retired'}">
          <a class="profile-collection-name" href="/item?key=${encodeURIComponent(item.key)}">${name}</a>
          <span class="profile-collection-kind">${esc(item.category ?? 'Unknown')}</span>
          <span class="profile-collection-count">${fmt(item.quantity)} owned</span>
          ${sellForm}
        </li>`;
      }).join('')}</ul>`
      : '<p>No items yet. Use <code>/scavenge</code> to find some.</p>';
  } catch (error) {
    if (profileId === id) $('#profileItems').textContent = `Could not load item inventory. ${error.message}`;
  }
}

function describeProfileBoost(bonus) {
  const amount = Number(bonus.multiplier).toLocaleString(undefined, { maximumFractionDigits: 4 });
  switch (bonus.type) {
    case 'scavengeRarity': return ['Rare finds', '◇', `${amount}× weight for Rare-or-better scavenged items.`];
    case 'extraFindChance': return ['Extra find', '✚', `Adds ${Number(bonus.multiplier * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} percentage points to the extra-item chance (total capped at 75%).`];
    case 'lootboxDrop': return ['Lootbox hunter', '▣', `${amount}× message lootbox drop chance, capped at 100%.`];
    case 'lootboxRarity': return ['Lootbox fortune', '◇', `${amount}× higher-rarity weighting per tier for lootboxes, not a guaranteed rarity.`];
    case 'lootboxReward': return ['Reward rarity', '✦', `${amount}× higher-rarity weighting per tier for lootbox items and companions, not a guaranteed rarity.`];
    case 'lootboxFind': return ['Treasure recovery', '◆', `${amount}× item and companion reward weights relative to boosts when opening lootboxes.`];
    default: return ['Unknown boost', '?', `Effect details unavailable for ${bonus.type}; stored value ${amount}.`];
  }
}

function renderProfileBoosts(bonuses) {
  const now = Date.now();
  const active = bonuses.filter(bonus => {
    const expires = Date.parse(bonus.expiresAt);
    return !Number.isFinite(expires) || expires > now;
  });
  $('#profileBoosts').innerHTML = active.length
    ? `<ul class="boost-list">${active.map(bonus => {
      const [name, icon, description] = describeProfileBoost(bonus);
      const expiry = new Date(bonus.expiresAt);
      const expiresAt = Number.isFinite(expiry.getTime()) ? expiry.toLocaleString() : 'Expiry unavailable';
      return `<li class="boost-card"><span class="boost-icon" aria-hidden="true">${icon}</span>
        <div><h4>${esc(name)}</h4><p>${esc(description)}</p><span class="boost-expiry">${esc(expiresAt === 'Expiry unavailable' ? expiresAt : `Expires ${expiresAt}`)}</span></div></li>`;
    }).join('')}</ul>`
    : '<p class="boost-empty">No temporary boosts are active. Use a consumable or activate a lootbox boost to get started.</p>';
  window.clearTimeout(boostExpiryTimer);
  const expiries = active.map(bonus => Date.parse(bonus.expiresAt)).filter(Number.isFinite);
  if (expiries.length) {
    const delay = Math.min(2147483647, Math.max(1, Math.min(...expiries) - now + 1));
    boostExpiryTimer = window.setTimeout(() => renderProfileBoosts(bonuses), delay);
  }
}

async function loadProfileBoosts(id) {
  const request = ++boostRequest;
  window.clearTimeout(boostExpiryTimer);
  $('#profileBoosts').textContent = 'Loading active boosts…';
  try {
    const response = await fetch(`/api/items/player/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.bonuses)) throw new Error('Boost data is unavailable.');
    if (profileId === id && request === boostRequest) renderProfileBoosts(data.bonuses);
  } catch (error) {
    if (profileId === id && request === boostRequest) $('#profileBoosts').textContent = `Could not load active boosts. ${error.message}`;
  }
}

async function sellProfileItem(event) {
  const form = event.target;
  if (!form.matches('.profile-sell-form')) return;
  event.preventDefault();
  const id = profileId;
  if (salePending || !currentUser || currentUser.id !== id) return;
  const quantity = Number(form.elements.quantity.value);
  const maximum = Number(form.elements.quantity.max);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximum) {
    $('#profileSaleStatus').textContent = 'Choose a whole number between 1 and the number you own.';
    return;
  }
  salePending = true;
  form.querySelector('button').disabled = true;
  $('#profileSaleStatus').textContent = 'Selling item…';
  try {
    let message;
    try {
      const response = await fetch('/api/items/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: form.dataset.item, quantity }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      message = `Sold ${data.quantity} × ${data.item} for $${Number(data.proceeds).toLocaleString()}.${data.unequipped ? ' Your tool was unequipped.' : ''}`;
    } catch (error) {
      message = `Sale could not be confirmed: ${error.message}. Check your inventory before trying again.`;
    }
    if (profileId !== id) return;
    await loadPlayers(true);
    if (profileId !== id) return;
    await loadProfile(id, true);
    if (profileId === id) $('#profileSaleStatus').textContent = message;
  } finally {
    salePending = false;
    $('#profileItems').querySelectorAll('.profile-sell-form button').forEach(button => { button.disabled = false; });
  }
}

async function loadProfileCompanions(id) {
  try {
    const response = await fetch(`/api/companions/player/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    if (profileId !== id) return;
    $('#profileCompanions').innerHTML = data.companions.length
      ? `<ul class="profile-collection-list">${data.companions.map(companion => {
        const name = esc(companion.name ?? `${companion.key} (retired)`);
        const label = companion.name
          ? `<a class="profile-collection-name" href="/companion?key=${encodeURIComponent(companion.key)}">${name}</a>`
          : `<span class="profile-collection-name">${name}</span>`;
        const rarity = String(companion.rarity ?? '').toLowerCase();
        return `<li class="profile-collection-card rarity-${/^(common|uncommon|rare|epic|legendary|mythic|eternal)$/.test(rarity) ? rarity : 'retired'}">
          ${label}
          <span class="profile-collection-kind">${esc(companion.rarity ?? 'Retired')}</span>
          <span class="profile-collection-count">${fmt(companion.quantity)} owned${companion.equipped ? ' · Equipped' : ''}</span>
        </li>`;
      }).join('')}</ul>`
      : '<p>No companions yet.</p>';
  } catch (error) {
    if (profileId === id) $('#profileCompanions').textContent = `Could not load companions. ${error.message}`;
  }
}

function compareGlobalRank(a, b) {
  return Number(b.prestige ?? 0) - Number(a.prestige ?? 0) ||
    Number(b.level ?? 0) - Number(a.level ?? 0) ||
    Number(b.experience ?? 0) - Number(a.experience ?? 0) ||
    Number(b.balance ?? 0) - Number(a.balance ?? 0) ||
    String(a.id).localeCompare(String(b.id));
}

function showLeaderboard() {
  $('#listView').classList.remove('hidden');
  $('#profileView').classList.add('hidden');
  setNavCurrent('leaderboard');
  if (allPlayers.length > 0) {
    renderPlayers();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showOwnProfile() {
  if (!currentUser) {
    return;
  }

  $('#listView').classList.add('hidden');
  $('#profileView').classList.remove('hidden');
  setNavCurrent('profile');
  $('#jumpToPlayer').classList.remove('hidden');
  await loadProfile(currentUser.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jumpToCurrentPlayer() {
  if (!currentUser) {
    return;
  }

  $('#search').value = '';
  const playerIndex = allPlayers.findIndex(
    player => String(player.id) === String(currentUser.id)
  );

  if (playerIndex === -1) {
    showLeaderboard();
    showError('Your Discord account does not have a player record on the leaderboard yet.');
    return;
  }

  currentPage = 1;
  showLeaderboard();
  renderPlayers();
  document
    .querySelector('#current-player-row')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function initializeAuth() {
  const auth = await authReady;
  currentUser = auth.user;
}

function updateSortIndicators() {
  document
    .querySelectorAll('.sort-button')
    .forEach(button => {
      const key = button.dataset.sort;
      const header = button.closest('th');
      const arrow = button.querySelector('.sort-arrow');

      button.classList.remove('active', 'desc');
      header.removeAttribute('aria-sort');

      if (key === sortState.key) {
        button.classList.add('active');

        if (sortState.direction === 'desc') {
          button.classList.add('desc');
          arrow.textContent = '▼';
          header.setAttribute('aria-sort', 'descending');
        } else {
          arrow.textContent = '▲';
          header.setAttribute('aria-sort', 'ascending');
        }
      } else {
        arrow.textContent = '↕';
      }
    });
}

$('#search').addEventListener('input', () => {
  currentPage = 1;
  renderPlayers();
});

$('#returnToLedger').addEventListener('click', showLeaderboard);
$('#jumpToPlayer').addEventListener('click', jumpToCurrentPlayer);
$('#profileItems').addEventListener('submit', sellProfileItem);
$('#refreshProfileBoosts').addEventListener('click', () => {
  if (profileId) void loadProfileBoosts(profileId);
});
$('#profileNameForm').addEventListener('submit', saveProfileName);
for (const [index, tab] of profileTabs.entries()) {
  $(`#profileTab-${tab}`).addEventListener('click', () => selectProfileTab(tab));
  $(`#profileTab-${tab}`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const available = profileTabs.filter(name => name !== 'settings' || currentUser?.id === profileId);
    const currentIndex = available.indexOf(profileTabs[index]);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length;
    selectProfileTab(available[nextIndex], true);
  });
}
$('#profileAvatar').addEventListener('error', () => {
  $('#profileAvatar').classList.add('hidden');
  $('#avatar').classList.remove('hidden');
});

document
  .querySelectorAll('.sort-button')
  .forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;

      if (!key) {
        return;
      }

      if (sortState.key === key) {
        sortState.direction =
          sortState.direction === 'desc'
            ? 'asc'
            : 'desc';
      } else {
        sortState.key = key;
        sortState.direction = 'desc';
      }

      saveSortState();
      currentPage = 1;
      renderPlayers();
    });
  });

async function initializePage() {
  await initializeAuth();

  const authError = new URLSearchParams(location.search).get('authError');
  if (authError === 'not-configured') {
    showError('Discord login is not configured on this server yet.');
  } else if (authError === 'discord') {
    showError('Discord login failed. Please try again.');
  }

  const requestedPlayerId = new URLSearchParams(location.search).get('id');
  if (new URLSearchParams(location.search).get('view') === 'profile' && currentUser) {
    await loadPlayers();
    await showOwnProfile();
  } else if (requestedPlayerId) {
    await loadPlayers();
    $('#listView').classList.add('hidden');
    $('#profileView').classList.remove('hidden');
    $('#jumpToPlayer').classList.toggle(
      'hidden',
      !currentUser || currentUser.id !== requestedPlayerId
    );
    await loadProfile(requestedPlayerId);
  } else {
    showLeaderboard();
    await loadPlayers();
  }
}

window.addEventListener('resize', () => {
  if (!$('#listView').classList.contains('hidden')) {
    renderPlayers();
  }
});

void initializePage();

function renderPagination(totalPages, totalPlayers) {
  const pagination = $('#pagination');

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    pagination.classList.add('hidden');
    return;
  }

  pagination.classList.remove('hidden');

  const firstPlayer = (currentPage - 1) * PLAYERS_PER_PAGE + 1;
  const lastPlayer = Math.min(currentPage * PLAYERS_PER_PAGE, totalPlayers);

  pagination.innerHTML = `
    <button
      type="button"
      class="page-button"
      id="previousPage"
      ${currentPage === 1 ? 'disabled' : ''}
    >
      Previous
    </button>

    <span class="page-number">
      Showing ${firstPlayer}–${lastPlayer} of ${totalPlayers}
      <span>Page ${currentPage} of ${totalPages}</span>
    </span>

    <button
      type="button"
      class="page-button"
      id="nextPage"
      ${currentPage === totalPages ? 'disabled' : ''}
    >
      Next
    </button>
  `;

  $('#previousPage').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderPlayers();
    }
  });

  $('#nextPage').addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage += 1;
      renderPlayers();
    }
  });
}
