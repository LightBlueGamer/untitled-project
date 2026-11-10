const wikiStatus = document.querySelector('#wikiStatus');
const wikiDetails = document.querySelector('#wikiDetails');
const wikiRetry = document.querySelector('#wikiRetry');
const wikiKey = new URLSearchParams(location.search).get('key');

function formatOdds(value) {
  return value === 0 ? '0' : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

function formatOneIn(percentage) {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('Invalid encounter probability.');
  }
  if (percentage === 0) return 'Cannot appear';
  return `1 in ${Math.round(100 / percentage).toLocaleString()}`;
}

async function loadCompanionWiki() {
  wikiStatus.textContent = 'Loading companion…';
  wikiDetails.classList.add('hidden');
  wikiRetry.classList.add('hidden');
  try {
    if (!wikiKey) throw new Error('No companion specified.');
    const response = await fetch(`/api/companions/wiki/${encodeURIComponent(wikiKey)}`, { cache: 'no-store' });
    if (response.status === 404) throw new Error('Companion not found.');
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const companion = await response.json();
    const rarities = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Eternal'];
    wikiDetails.className = `rarity-${rarities.includes(companion.rarity) ? companion.rarity.toLowerCase() : 'retired'}`;
    document.querySelector('#wikiName').textContent = companion.name;
    document.querySelector('#wikiRarity').textContent = companion.rarity;
    document.querySelector('#wikiDescription').textContent = companion.description;
    document.querySelector('#wikiCount').textContent = BigInt(companion.quantity).toLocaleString();
    document.querySelector('#wikiWeight').textContent = formatOdds(companion.weight);
    document.querySelector('#wikiChance').textContent = formatOneIn(companion.percentage);
    const stats = Object.entries(companion.stats).map(([name, value]) => {
      const item = document.createElement('div');
      const label = document.createElement('dt');
      const amount = document.createElement('dd');
      label.textContent = name;
      amount.textContent = value;
      item.append(label, amount);
      return item;
    });
    document.querySelector('#wikiStats').replaceChildren(...stats);
    wikiStatus.textContent = '';
  } catch (error) {
    wikiStatus.textContent = `Could not load companion. ${error.message}`;
    wikiRetry.classList.remove('hidden');
  }
}

wikiRetry.addEventListener('click', loadCompanionWiki);
void loadCompanionWiki();
