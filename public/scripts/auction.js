const auctionId = new URLSearchParams(location.search).get('id');
const auctionStatus = document.querySelector('#auctionStatus');
let countdownTimer;
const escapeAuction = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function auctionRequest(path = '', body) {
  const response = await fetch(`/api/auctions/${encodeURIComponent(auctionId)}${path}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function loadAuction() {
  try {
    if (!auctionId || !/^[1-9]\d*$/.test(auctionId)) throw new Error('Invalid auction ID.');
    const [auction, auth] = await Promise.all([auctionRequest(), authReady]);
    document.querySelector('#auctionDetails').innerHTML = `<h2>${escapeAuction(auction.title)}</h2>
      <p class="market-description">${escapeAuction(auction.description)}</p>
      <p><strong>Asset:</strong> ${escapeAuction(auction.asset.quantity)} × ${escapeAuction(auction.asset.name)} (${escapeAuction(auction.asset.kind)})</p>
      <p><strong>Seller:</strong> <a href="/leaderboard?id=${encodeURIComponent(auction.seller_id)}">${escapeAuction(auction.seller_name)}</a></p>
      <p><strong>${auction.high_bid ? 'Highest bid' : 'Starting bid'}:</strong> $${Number(auction.high_bid || auction.starting_price).toLocaleString()}</p>
      <p><strong>Status:</strong> ${escapeAuction(auction.status)} · Ends ${escapeAuction(new Date(auction.ends_at).toLocaleString())} <span id="auctionCountdown"></span></p>
      <p><strong>Daily fee:</strong> $${Number(auction.daily_fee).toLocaleString()}</p>`;
    document.querySelector('#auctionBids').innerHTML = auction.bids.length ? `<ol>${auction.bids.map(bid =>
      `<li><a href="/leaderboard?id=${encodeURIComponent(bid.bidder_id)}">${escapeAuction(bid.bidder_name)}</a> — $${Number(bid.amount).toLocaleString()} · ${escapeAuction(new Date(bid.created_at).toLocaleString())}</li>`).join('')}</ol>` : '<p>No bids yet.</p>';
    const active = auction.status === 'active' && new Date(auction.ends_at).getTime() > Date.now() && Boolean(auth.user);
    const minimumBid = auction.high_bid ? Number(auction.high_bid) + Math.max(1, Math.ceil(Number(auction.high_bid) * 0.05)) : Number(auction.starting_price);
    document.querySelector('#bidAmount').min = String(minimumBid);
    document.querySelector('#bidMinimum').textContent = `Minimum bid: $${minimumBid.toLocaleString()}`;
    window.clearInterval(countdownTimer);
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((new Date(auction.ends_at).getTime() - Date.now()) / 1000));
      const days = Math.floor(remaining / 86400), hours = Math.floor(remaining % 86400 / 3600);
      const minutes = Math.floor(remaining % 3600 / 60), seconds = remaining % 60;
      document.querySelector('#auctionCountdown').textContent = auction.status === 'active' ? `(${days}d ${hours}h ${minutes}m ${seconds}s remaining)` : '';
      if (!remaining) {
        window.clearInterval(countdownTimer);
        document.querySelector('#auctionActions').classList.add('hidden');
      }
    };
    updateCountdown();
    if (auction.status === 'active' && new Date(auction.ends_at).getTime() > Date.now()) countdownTimer = window.setInterval(updateCountdown, 1000);
    const own = active && auth.user.id === auction.seller_id;
    document.querySelector('#auctionActions').classList.toggle('hidden', !active);
    document.querySelector('#bidForm').classList.toggle('hidden', !active || own);
    document.querySelector('#sellerActions').classList.toggle('hidden', !own);
    auctionStatus.textContent = '';
  } catch (error) { auctionStatus.textContent = `Could not load auction. ${error.message}`; }
}
async function submitAuction(button, path, body) {
  button.disabled = true;
  try { await auctionRequest(path, body); await loadAuction(); auctionStatus.textContent = 'Action completed.'; }
  catch (error) { auctionStatus.textContent = `Action failed. ${error.message}`; }
  finally { button.disabled = false; }
}
document.querySelector('#bidForm').addEventListener('submit', event => {
  event.preventDefault();
  void submitAuction(event.submitter, '/bid', { amount: Number(document.querySelector('#bidAmount').value) });
});
document.querySelector('#promoteForm').addEventListener('submit', event => {
  event.preventDefault();
  void submitAuction(event.submitter, '/promote', { amount: Number(document.querySelector('#promoteAmount').value) });
});
document.querySelector('#endAuction').addEventListener('click', event => {
  if (window.confirm('End this auction now? The highest bidder will win.')) void submitAuction(event.currentTarget, '/end', {});
});
void loadAuction();
