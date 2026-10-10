const API_BASE = '/api/players';
const $ = s => document.querySelector(s);
let allPlayers = [];
let currentPage = 1;
let currentUser = null;

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
    })

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
            href="?id=${encodeURIComponent(player.id)}"
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

async function loadPlayers() {
  try {
    const r = await fetch(API_BASE);
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    const data = await r.json();
    allPlayers = Array.isArray(data) ? data : (data.players ?? []);
    renderPlayers();
  } catch (e) {
    showError(`Could not load the ledger. ${e.message}`);
    $('#status').textContent = 'The records could not be summoned.';
  }
}

function stat(label, value, wide = false) {
  return `<div class="stat ${wide ? 'wide' : ''}"><label>${label}</label><strong>${fmt(value)}</strong></div>`;
}

async function loadProfile(id) {
  try {
    const r = await fetch(`${API_BASE}/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Player not found' : `Request failed (${r.status})`);
    const p = await r.json();
    $('#profileName').textContent = p.name || 'Unknown adventurer';
    $('#avatar').textContent = (p.name || '?').charAt(0).toUpperCase();
    const globalRank = [...allPlayers]
      .sort(compareGlobalRank)
      .findIndex(player => String(player.id) === String(p.id)) + 1;

    $('#profileRank').textContent = globalRank
      ? `Leaderboard rank #${globalRank}`
      : 'Unranked';
    $('#statGrid').innerHTML = stat('Prestige', p.prestige) + stat('Level', p.level) + stat('Experience', `${p.experience}`) + stat('Balance', `$${Number(p.balance ?? 0).toLocaleString()}`) + stat('Experience multiplier', `${p.experienceMultiplier ?? 1}×`) + stat('Balance multiplier', `${p.balanceMultiplier ?? 1}×`);
  } catch (e) {
    $('#statGrid').innerHTML = `<div class="error wide">${esc(e.message)}</div>`;
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
  $('#leaderboardTab').setAttribute('aria-current', 'page');
  $('#profileTab').removeAttribute('aria-current');
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
  $('#leaderboardTab').removeAttribute('aria-current');
  $('#profileTab').setAttribute('aria-current', 'page');
  $('#jumpToPlayer').classList.remove('hidden');
  await loadProfile(currentUser.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jumpToCurrentPlayer() {
  if (!currentUser) {
    return;
  }

  $('#search').value = '';
  const sortedPlayers = [...allPlayers].sort(comparePlayers);
  const playerIndex = sortedPlayers.findIndex(
    player => String(player.id) === currentUser.id
  );

  if (playerIndex === -1) {
    showLeaderboard();
    showError('Your Discord account does not have a player record on the leaderboard yet.');
    return;
  }

  currentPage = Math.floor(playerIndex / PLAYERS_PER_PAGE) + 1;
  showLeaderboard();
  renderPlayers();
  document
    .querySelector('#current-player-row')
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function initializeAuth() {
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const auth = await response.json();
    currentUser = auth.user;
    $('#loginLink').classList.toggle('hidden', Boolean(currentUser) || !auth.enabled);
    $('#loggedInNav').classList.toggle('hidden', !currentUser);
    if (currentUser) {
      $('#accountName').textContent = currentUser.displayName;
    } else if (!auth.enabled) {
      $('#loginLink').classList.remove('hidden');
      $('#loginLink').textContent = 'Discord login unavailable';
      $('#loginLink').setAttribute('aria-disabled', 'true');
      $('#loginLink').removeAttribute('href');
    }
  } catch (error) {
    console.error('Could not check Discord login status:', error);
    $('#loginLink').classList.remove('hidden');
    $('#loginLink').textContent = 'Discord login unavailable';
    $('#loginLink').setAttribute('aria-disabled', 'true');
    $('#loginLink').removeAttribute('href');
  }
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

$('#leaderboardTab').addEventListener('click', showLeaderboard);
$('#profileTab').addEventListener('click', showOwnProfile);
$('#returnToLedger').addEventListener('click', showLeaderboard);
$('#jumpToPlayer').addEventListener('click', jumpToCurrentPlayer);

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
  if (requestedPlayerId) {
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
