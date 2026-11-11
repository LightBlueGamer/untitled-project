const itemStatus = document.querySelector('#itemStatus');
const itemDetails = document.querySelector('#itemDetails');
const itemRetry = document.querySelector('#itemRetry');
const itemKey = new URLSearchParams(location.search).get('key');

async function loadItem() {
  itemStatus.textContent = 'Loading item…';
  itemDetails.classList.add('hidden');
  itemRetry.classList.add('hidden');
  try {
    if (!itemKey) throw new Error('No item specified.');
    const response = await fetch(`/api/items/${encodeURIComponent(itemKey)}`, { cache: 'no-store' });
    if (response.status === 404) throw new Error('Item not found.');
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const item = await response.json();
    const rarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Eternal'];
    itemDetails.className = `rarity-${rarities.includes(item.rarity) ? item.rarity.toLowerCase() : 'retired'}`;
    document.querySelector('#itemName').textContent = item.name;
    document.querySelector('#itemType').textContent = `${item.category} · ${item.rarity}`;
    document.querySelector('#itemDescription').textContent = item.description;
    document.querySelector('#itemPrice').textContent = `$${Number(item.price).toLocaleString()}`;
    document.querySelector('#itemOdds').textContent = item.odds != null
      ? `1 in ${Math.round(item.odds).toLocaleString()}`
      : 'Not scavengable';
    document.querySelector('#itemCirculation').textContent = BigInt(item.circulation ?? 0).toLocaleString();
    document.querySelector('#itemScavenge').textContent = item.canScavenge ? 'Yes' : 'No';

    const recipeSection = document.querySelector('#itemRecipeSection');
    const recipe = document.querySelector('#itemRecipe');
    recipe.replaceChildren(...item.recipe.map(ingredient => {
      const row = document.createElement('li');
      row.textContent = `${ingredient.name} × ${ingredient.quantity}`;
      return row;
    }));
    recipeSection.classList.toggle('hidden', item.recipe.length === 0);

    const bonusSection = document.querySelector('#itemToolBonusSection');
    const displayedBonus = item.capacity != null ? `${item.capacity} storage slots` : item.toolBonus ?? item.consumableEffect;
    bonusSection.classList.toggle('hidden', !displayedBonus);
    document.querySelector('#itemToolBonusHeading').textContent = item.capacity != null ? 'Backpack capacity' : item.consumableBonus ? 'Consumable effect' : 'Tool bonus';
    document.querySelector('#itemToolBonus').textContent = displayedBonus ?? '';

    const rulesSection = document.querySelector('#itemToolRulesSection');
    const rules = [];
    if (item.toolsWithBonus.length) rules.push(`Improved by: ${item.toolsWithBonus.join(', ')}.`);
    if (item.blacklistTools.length) rules.push(`Cannot be found with: ${item.blacklistTools.join(', ')}.`);
    rulesSection.classList.toggle('hidden', rules.length === 0);
    document.querySelector('#itemToolRules').textContent = rules.join(' ');
    itemStatus.textContent = '';
  } catch (error) {
    itemStatus.textContent = `Could not load item. ${error.message}`;
    itemRetry.classList.remove('hidden');
  }
}

itemRetry.addEventListener('click', loadItem);
void loadItem();
