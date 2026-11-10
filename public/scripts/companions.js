const companionStatus = document.querySelector('#companionStatus');
const companionBody = document.querySelector('#companionBody');
const companionRetry = document.querySelector('#companionRetry');
const companionSortButtons = document.querySelectorAll('.companion-table .sort-button');
const rarityOrder = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Eternal'];
let companionRecords = [];
let companionSort = { key: 'rarity', direction: 'desc' };

function renderCompanions() {
  const rows = [...companionRecords].sort((a, b) => {
    let comparison;
    if (companionSort.key === 'quantity') {
      const left = BigInt(a.quantity), right = BigInt(b.quantity);
      comparison = left < right ? -1 : left > right ? 1 : 0;
    } else if (companionSort.key === 'rarity') {
      comparison = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
    } else {
      comparison = (a.name ?? a.key).localeCompare(b.name ?? b.key);
    }
    return comparison * (companionSort.direction === 'asc' ? 1 : -1)
      || (a.name ?? a.key).localeCompare(b.name ?? b.key);
  }).map(companion => {
    const row = document.createElement('tr');
    row.className = `rarity-${rarityOrder.includes(companion.rarity) ? companion.rarity.toLowerCase() : 'retired'}`;
    const nameCell = document.createElement('td');
    if (companion.name) {
      const link = document.createElement('a');
      link.href = `/companion?key=${encodeURIComponent(companion.key)}`;
      link.textContent = companion.name;
      nameCell.appendChild(link);
    } else {
      nameCell.textContent = `${companion.key} (retired)`;
    }
    row.appendChild(nameCell);
    [companion.rarity ?? 'Retired', BigInt(companion.quantity).toLocaleString()].forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    return row;
  });
  companionBody.replaceChildren(...rows);
  companionSortButtons.forEach(button => {
    const active = button.dataset.sort === companionSort.key;
    button.classList.toggle('active', active);
    button.querySelector('.sort-arrow').textContent = active ? (companionSort.direction === 'asc' ? '↑' : '↓') : '↕';
    const header = button.closest('th');
    if (active) header.setAttribute('aria-sort', companionSort.direction === 'asc' ? 'ascending' : 'descending');
    else header.removeAttribute('aria-sort');
  });
  companionStatus.textContent = `${rows.length} companion species`;
}

async function loadCompanionCirculation() {
  companionStatus.textContent = 'Loading companion records…';
  companionRetry.classList.add('hidden');
  try {
    const response = await fetch('/api/companions/circulation', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    companionRecords = data.companions;
    renderCompanions();
  } catch (error) {
    companionBody.replaceChildren();
    companionStatus.textContent = `Could not load companion circulation. ${error.message}`;
    companionRetry.classList.remove('hidden');
  }
}

companionSortButtons.forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.sort;
  if (companionSort.key === key) companionSort.direction = companionSort.direction === 'asc' ? 'desc' : 'asc';
  else companionSort = { key, direction: key === 'name' ? 'asc' : 'desc' };
  renderCompanions();
}));
companionRetry.addEventListener('click', loadCompanionCirculation);
void loadCompanionCirculation();
