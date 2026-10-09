const API_BASE = '/api/players';
const $ = s => document.querySelector(s);
let allPlayers = [];
let currentPage = 1;

const PLAYERS_PER_PAGE = 10;

let sortState = {
  key: 'prestige',
  direction: 'desc'
};

const SORT_STORAGE_KEY = 'ledger-sort-preference';
const SORT_KEYS = ['prestige', 'level', 'balance'];
const SORT_DIRECTIONS = ['asc', 'desc'];

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

function renderPlayers() {
  const query = $('#search').value.trim().toLowerCase();

  const filteredPlayers = allPlayers
    .filter(player => {
      const name = String(player.name ?? '').toLowerCase();
      const id = String(player.id ?? '');

      return name.includes(query) || id.includes(query);
    })
    .sort(comparePlayers);

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
    .map(player => `
      <tr>
        <td class="name">
          ${esc(player.name || 'Unknown')}
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
    `)
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
}

function comparePlayers(a, b) {
  let difference = 0;

  if (sortState.key === 'prestige') {
    difference = Number(b.prestige ?? 0) - Number(a.prestige ?? 0);
  }

  if (sortState.key === 'level') {
    difference = Number(b.level ?? 0) - Number(a.level ?? 0);

    if (difference === 0) {
      difference = Number(b.experience ?? 0) - Number(a.experience ?? 0);
    }
  }

  if (sortState.key === 'balance') {
    difference = Number(b.balance ?? 0) - Number(a.balance ?? 0);
  }

  return sortState.direction === 'asc'
    ? -difference
    : difference;
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
  $('#listView').classList.add('hidden');
  $('#profileView').classList.remove('hidden');
  try {
    const r = await fetch(`${API_BASE}/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Player not found' : `Request failed (${r.status})`);
    const p = await r.json();
    $('#profileName').textContent = p.name || 'Unknown adventurer';
    $('#avatar').textContent = (p.name || '?').charAt(0).toUpperCase();
    $('#statGrid').innerHTML = stat('Prestige', p.prestige) + stat('Level', p.level) + stat('Experience', `${p.experience}`) + stat('Balance', `$${Number(p.balance ?? 0).toLocaleString()}`) + stat('Experience multiplier', `${p.experienceMultiplier ?? 1}×`) + stat('Balance multiplier', `${p.balanceMultiplier ?? 1}×`);
  } catch (e) {
    $('#statGrid').innerHTML = `<div class="error wide">${esc(e.message)}</div>`;
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

const id = new URLSearchParams(location.search).get('id');
if (id) {
  loadProfile(id);
} else {
  loadPlayers();
}

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
