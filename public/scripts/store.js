const marketStatus = document.querySelector('#marketStatus');
const escapeMarket = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const marketMoney = value => Number(value).toLocaleString();
let marketPage = 0;
let shopGeneration = null;
let shopLoadPromise = null;
let shopItems = [];
let shopUser = null;
let historyPage = 0;
async function marketRequest(path, body) {
  const response = await fetch(`/api/auctions${path}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function loadMarket() {
  marketStatus.textContent = 'Loading auctions…';
  document.querySelector('#marketPrevious').disabled = true;
  document.querySelector('#marketNext').disabled = true;
  try {
    const { auctions, hasMore } = await marketRequest(`?page=${marketPage}`);
    document.querySelector('#marketListings').innerHTML = auctions.length ? auctions.map(auction => {
      const promoted = auction.promotion_ends_at && new Date(auction.promotion_ends_at) > new Date();
      return `<article class="market-card${promoted ? ' promoted' : ''}">${promoted ? '<span class="market-promotion">✦ Promoted</span>' : ''}
        <h3><a href="/auction?id=${encodeURIComponent(auction.id)}">${escapeMarket(auction.title)}</a></h3>
        <p>${escapeMarket(auction.asset.quantity)} × ${escapeMarket(auction.asset.name)} · ${escapeMarket(auction.asset.kind)}</p>
        <p>${auction.high_bid ? 'Current bid' : 'Starting bid'}: <strong>$${marketMoney(auction.high_bid || auction.starting_price)}</strong></p>
        <p>Seller: ${escapeMarket(auction.seller_name)} · Ends ${escapeMarket(new Date(auction.ends_at).toLocaleString())}</p></article>`;
    }).join('') : '<p>No auctions are currently listed.</p>';
    document.querySelector('#marketPrevious').disabled = marketPage === 0;
    document.querySelector('#marketNext').disabled = !hasMore;
    document.querySelector('#marketPage').textContent = `Page ${marketPage + 1}`;
    marketStatus.textContent = '';
  } catch (error) {
    document.querySelector('#marketPrevious').disabled = marketPage === 0;
    marketStatus.textContent = `Could not load auctions. ${error.message}`;
  }
}
async function loadAccount() {
  try {
    const [account, inventory] = await Promise.all([marketRequest('/account'), marketRequest('/inventory')]);
    document.querySelector('#marketClaims').innerHTML = account.claims.length ? `<h3>Ready to claim</h3>${account.claims.map(claim =>
      `<p>${escapeMarket(claim.asset.quantity)} × ${escapeMarket(claim.asset.name)} · Auction #${escapeMarket(claim.auction_id)} <button class="btn claim-button" type="button" data-claim="${escapeMarket(claim.id)}">Claim</button></p>`).join('')}` : '<p>No assets waiting to be claimed.</p>';
    document.querySelector('#marketNotifications').innerHTML = account.notifications.length ? `<h3>Notifications</h3><ul>${account.notifications.map(note =>
      `<li>${escapeMarket(note.message)}${note.read_at ? '' : ' · New'}</li>`).join('')}</ul>` : '<p>No auction notifications.</p>';
    const select = document.querySelector('#listingAsset');
    select.innerHTML = inventory.assets.length ? inventory.assets.map((asset, index) =>
      `<option value="${index}">${escapeMarket(asset.name)} (${escapeMarket(asset.kind)} · ${escapeMarket(asset.quantity)} owned)</option>`).join('') : '<option value="">No eligible assets</option>';
    select.assets = inventory.assets;
  } catch (error) { marketStatus.textContent = `Could not load your auction account. ${error.message}`; }
}
document.querySelector('#listingForm').addEventListener('submit', async event => {
  event.preventDefault();
  const select = document.querySelector('#listingAsset');
  const asset = select.assets?.[Number(select.value)];
  if (!asset || select.value === '') { marketStatus.textContent = 'Choose an eligible asset.'; return; }
  const button = event.submitter;
  button.disabled = true;
  try {
    const listing = await marketRequest('', { kind: asset.kind, key: asset.key,
      quantity: Number(document.querySelector('#listingQuantity').value), title: document.querySelector('#listingTitle').value,
      description: document.querySelector('#listingDescription').value, price: Number(document.querySelector('#listingPrice').value),
      hours: Number(document.querySelector('#listingHours').value) });
    location.href = `/auction?id=${encodeURIComponent(listing.id)}`;
  } catch (error) { marketStatus.textContent = `Could not create listing. ${error.message}`; }
  finally { button.disabled = false; }
});
document.querySelector('#marketClaims').addEventListener('click', async event => {
  const button = event.target.closest('.claim-button');
  if (!button) return;
  button.disabled = true;
  try { await marketRequest(`/claims/${encodeURIComponent(button.dataset.claim)}`, {}); await loadAccount(); }
  catch (error) { marketStatus.textContent = `Could not claim asset. ${error.message}`; button.disabled = false; }
});
document.querySelector('#markNotifications').addEventListener('click', async () => {
  try { await marketRequest('/notifications/read', {}); await loadAccount(); }
  catch (error) { marketStatus.textContent = `Could not mark notifications read. ${error.message}`; }
});
document.querySelector('#refreshMarket').addEventListener('click', async () => { await loadMarket(); if ((await authReady).user) await loadAccount(); });
document.querySelector('#marketPrevious').addEventListener('click', () => { if (marketPage > 0) { marketPage--; void loadMarket(); } });
document.querySelector('#marketNext').addEventListener('click', () => { marketPage++; void loadMarket(); });
const tabs = [document.querySelector('#auctionTab'), document.querySelector('#botShopTab')];
function selectMarketTab(index, focus) {
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
  document.querySelector('#auctionPanel').classList.toggle('hidden', index !== 0);
  document.querySelector('#botShopPanel').classList.toggle('hidden', index !== 1);
  if (index === 1) { void loadBotShop(); void loadShopHistory(); }
  if (focus) tabs[index].focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectMarketTab(index, false));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectMarketTab(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
  });
});
function renderBotShop() {
  const search = document.querySelector('#shopSearch').value.trim().toLowerCase();
  const rarity = document.querySelector('#shopRarity').value;
  const type = document.querySelector('#shopType').value;
  const matching = shopItems.filter(item => item.name.toLowerCase().includes(search) &&
    (!rarity || item.rarity === rarity) && (!type || item.category === type));
  document.querySelector('#botShopListings').innerHTML = matching.length ? matching.map(item => `<article class="market-card bot-shop-card${item.quantity ? '' : ' sold-out'}">
      <h3><a href="/item?key=${encodeURIComponent(item.key)}">${escapeMarket(item.name)}</a></h3>
      <p>${escapeMarket(item.rarity)} · ${escapeMarket(item.category)}</p>
      <p>${escapeMarket(item.description)}</p>
      <p>Base price: $${marketMoney(item.basePrice)} · Shop price: <strong>$${marketMoney(item.price)}</strong> each</p>
      <p>Stock: ${marketMoney(item.quantity)}</p>
      ${item.quantity && shopUser ? `<form class="bot-shop-buy market-form" data-key="${escapeMarket(item.key)}">
        <label>Quantity <input class="search" name="quantity" type="number" min="1" max="${item.quantity}" value="1" required></label>
        <button class="btn" type="submit">Buy</button></form>` : ''}
      ${item.quantity && !shopUser ? '<p>Sign in to purchase.</p>' : ''}
      ${item.quantity ? '' : '<div class="bot-shop-sold-out" aria-label="Out of stock"><span>Out of stock</span></div>'}
    </article>`).join('') : '<p>No items match these filters.</p>';
}
for (const selector of ['#shopSearch', '#shopRarity', '#shopType']) {
  document.querySelector(selector).addEventListener('input', renderBotShop);
}
function loadBotShop() {
  if (shopLoadPromise) return shopLoadPromise;
  shopLoadPromise = (async () => {
    const status = document.querySelector('#botShopStatus');
    try {
      const response = await fetch('/api/bot-shop', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      shopGeneration = data.generation;
      document.querySelector('#botShopRestock').textContent = `Next restock: ${new Date(data.nextRefreshAt).toLocaleString()}`;
      shopUser = (await authReady).user;
      shopItems = data.items;
      renderBotShop();
      status.textContent = '';
    } catch (error) { status.textContent = `Could not load Bot Shop. ${error.message}`; }
  })().finally(() => { shopLoadPromise = null; });
  return shopLoadPromise;
}
async function loadShopHistory() {
  const status = document.querySelector('#shopHistoryStatus');
  document.querySelector('#shopHistoryPrevious').disabled = true;
  document.querySelector('#shopHistoryNext').disabled = true;
  try {
    const response = await fetch(`/api/bot-shop/history?page=${historyPage}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    document.querySelector('#shopHistoryPurchases').innerHTML = data.entries.length ? data.entries.map(item => `<li class="shop-purchase">
      <span class="shop-purchase-icon" aria-hidden="true">◆</span>
      <div class="shop-purchase-main"><strong><a href="/leaderboard?id=${encodeURIComponent(item.player_id)}">${escapeMarket(item.player_name)}</a> purchased
      <a href="/item?key=${encodeURIComponent(item.item_key)}">${escapeMarket(item.name)}</a></strong>
      <span>${marketMoney(item.quantity)} × $${marketMoney(item.unit_price)} each</span></div>
      <div class="shop-purchase-meta"><strong>$${marketMoney(item.total_price)}</strong>
      <time datetime="${escapeMarket(item.purchased_at)}">${escapeMarket(new Date(item.purchased_at).toLocaleString())}</time></div>
    </li>`).join('') : '<li class="shop-history-empty">No purchases recorded yet.</li>';
    document.querySelector('#shopHistoryPage').textContent = `Page ${historyPage + 1}`;
    document.querySelector('#shopHistoryPrevious').disabled = historyPage === 0;
    document.querySelector('#shopHistoryNext').disabled = !data.hasMore;
    status.textContent = '';
  } catch (error) {
    document.querySelector('#shopHistoryPrevious').disabled = historyPage === 0;
    status.textContent = `Could not load shop history. ${error.message}`;
  }
}
document.querySelector('#shopHistoryPrevious').addEventListener('click', () => { if (historyPage > 0) { historyPage--; void loadShopHistory(); } });
document.querySelector('#shopHistoryNext').addEventListener('click', () => { historyPage++; void loadShopHistory(); });
document.querySelector('#refreshBotShop').addEventListener('click', async event => {
  if (!window.confirm('Replace all current Bot Shop stock and prices?')) return;
  const button = event.currentTarget;
  const status = document.querySelector('#botShopRestockStatus');
  button.disabled = true;
  status.textContent = '';
  try {
    if (shopLoadPromise) await shopLoadPromise;
    const response = await fetch('/api/developer/bot-shop/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: '{}'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    if (shopLoadPromise) await shopLoadPromise;
    await Promise.all([loadBotShop(), loadShopHistory()]);
    status.textContent = 'Bot Shop restocked.';
  } catch (error) {
    status.textContent = `Could not restock Bot Shop. ${error.message}`;
  } finally { button.disabled = false; }
});
document.querySelector('#botShopListings').addEventListener('submit', async event => {
  const form = event.target.closest('.bot-shop-buy');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  const status = document.querySelector('#botShopStatus');
  button.disabled = true;
  try {
    const response = await fetch('/api/bot-shop/buy', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ key: form.dataset.key, quantity: Number(form.elements.quantity.value), generation: shopGeneration })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    await loadBotShop();
    await loadShopHistory();
    status.textContent = 'Purchase complete.';
  } catch (error) {
    await loadBotShop();
    status.textContent = `Could not purchase. ${error.message}`;
  } finally { button.disabled = false; }
});
window.setInterval(() => {
  if (!document.querySelector('#botShopPanel').classList.contains('hidden') &&
      !document.querySelector('#botShopListings').contains(document.activeElement)) {
    void loadBotShop();
    void loadShopHistory();
  }
}, 15000);
function openShopFromHash() { if (location.hash === '#bot-shop') selectMarketTab(1, false); }
window.addEventListener('hashchange', openShopFromHash);
openShopFromHash();
void loadMarket();
void authReady.then(auth => {
  document.querySelector('#refreshBotShop').classList.toggle('hidden', !auth.user || !auth.isDeveloper);
  if (auth.user) {
    document.querySelector('#marketAccount').classList.remove('hidden');
    document.querySelector('#marketCreate').classList.remove('hidden');
    document.querySelector('#marketLogin').classList.add('hidden');
    void loadAccount();
  }
});
