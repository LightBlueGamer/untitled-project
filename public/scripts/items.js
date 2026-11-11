const itemStatus = document.querySelector('#itemStatus');
const itemBody = document.querySelector('#itemBody');
const itemRetry = document.querySelector('#itemRetry');
const itemSearch = document.querySelector('#itemSearch');
const itemCategory = document.querySelector('#itemCategory');
const itemSortButtons = document.querySelectorAll('.item-table .sort-button');
const rarityOrder = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Eternal'];
let itemRecords = [];
let itemSort = { key: 'rarity', direction: 'desc' };

function renderItems() {
  const query = itemSearch.value.trim().toLocaleLowerCase();
  const category = itemCategory.value;
  const filtered = itemRecords.filter(item =>
    (!category || item.category === category)
    && [item.name, item.key, item.category, item.rarity]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(query)));
  const rows = [...filtered].sort((a, b) => {
    let comparison;
    if (itemSort.key === 'circulation') {
      const left = BigInt(a.circulation ?? 0);
      const right = BigInt(b.circulation ?? 0);
      comparison = left < right ? -1 : left > right ? 1 : 0;
    } else if (itemSort.key === 'odds') {
      comparison = (a.odds ?? Infinity) - (b.odds ?? Infinity);
    } else if (itemSort.key === 'price') {
      comparison = a[itemSort.key] - b[itemSort.key];
    } else if (itemSort.key === 'rarity') {
      comparison = rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
    } else if (itemSort.key === 'category') {
      comparison = a.category.localeCompare(b.category);
    } else if (itemSort.key === 'source') {
      comparison = (a.source ?? '').localeCompare(b.source ?? '');
    } else {
      comparison = a.name.localeCompare(b.name);
    }
    return comparison * (itemSort.direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name);
  }).map(item => {
    const row = document.createElement('tr');
    row.className = `rarity-${rarityOrder.includes(item.rarity) ? item.rarity.toLowerCase() : 'retired'}`;
    const nameCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `/item?key=${encodeURIComponent(item.key)}`;
    link.textContent = item.name;
    nameCell.appendChild(link);
    row.appendChild(nameCell);
    [
      item.category,
      item.rarity,
      `$${Number(item.price).toLocaleString()}`,
      item.odds == null ? '—' : `1 in ${Math.round(item.odds).toLocaleString()}`,
      BigInt(item.circulation ?? 0).toLocaleString(),
      item.source,
    ].forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });
    return row;
  });
  itemBody.replaceChildren(...rows);
  itemSortButtons.forEach(button => {
    const active = button.dataset.sort === itemSort.key;
    button.classList.toggle('active', active);
    button.querySelector('.sort-arrow').textContent = active
      ? (itemSort.direction === 'asc' ? '↑' : '↓')
      : '↕';
    const header = button.closest('th');
    if (active) header.setAttribute('aria-sort', itemSort.direction === 'asc' ? 'ascending' : 'descending');
    else header.removeAttribute('aria-sort');
  });
  itemStatus.textContent = !rows.length && (query || category)
    ? 'No items match your filters.'
    : `${rows.length} of ${itemRecords.length} items`;
}

async function loadItems() {
  itemStatus.textContent = 'Loading items…';
  itemRetry.classList.add('hidden');
  try {
    const response = await fetch('/api/items', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    itemRecords = data.items;
    const allCategories = document.createElement('option');
    allCategories.value = '';
    allCategories.textContent = 'All categories';
    itemCategory.replaceChildren(allCategories);
    data.categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      itemCategory.add(option);
    });
    renderItems();
  } catch (error) {
    itemBody.replaceChildren();
    itemStatus.textContent = `Could not load items. ${error.message}`;
    itemRetry.classList.remove('hidden');
  }
}

itemSortButtons.forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.sort;
  if (itemSort.key === key) itemSort.direction = itemSort.direction === 'asc' ? 'desc' : 'asc';
  else itemSort = { key, direction: ['name', 'category', 'source'].includes(key) ? 'asc' : 'desc' };
  renderItems();
}));
itemSearch.addEventListener('input', renderItems);
itemCategory.addEventListener('change', renderItems);
itemRetry.addEventListener('click', loadItems);
void loadItems();
