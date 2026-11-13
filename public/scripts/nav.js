const siteHeader = document.querySelector('#siteHeader');

siteHeader.className = 'site-header';
siteHeader.innerHTML = `
  <a class="site-brand" href="/"><span class="brand-emblem" aria-hidden="true">✦</span><span class="brand-copy"><strong>Prestigious Ledger</strong><small>AN ADVENTURER'S COMPANION</small></span></a>
  <nav id="accountNav" class="account-nav" aria-label="Account navigation">
    <a id="loginLink" class="btn hidden" href="/auth/discord">Login with Discord</a>
    <span id="accountName" class="account-name hidden"></span>
    <a id="homeTab" class="nav-link" href="/">Home</a>
    <a id="companionsTab" class="nav-link" href="/companions">Companions</a>
    <a id="itemsTab" class="nav-link" href="/items">Items</a>
    <a id="storeTab" class="nav-link" href="/store">Store</a>
    <a id="wikiTab" class="nav-link" href="/wiki">Wiki</a>
    <div id="loggedInNav" class="logged-in-nav hidden">
      <a id="leaderboardTab" class="nav-link" href="/leaderboard">Leaderboard</a>
      <a id="profileTab" class="nav-link" href="/leaderboard?view=profile">Profile</a>
      <a id="casinoTab" class="nav-link" href="/casino">Casino</a>
      <a id="developerTab" class="nav-link hidden" href="/developer">Developer</a>
      <form action="/auth/logout" method="post">
        <button class="nav-link" type="submit">Log out</button>
      </form>
    </div>
    <button id="themeToggle" class="nav-link theme-toggle" type="button" aria-label="Switch to light theme">☀ Light</button>
  </nav>
  <div id="shopRestockAlert" class="shop-restock-alert hidden" role="status" aria-live="polite">
    <a id="shopAlertLink" href="/store#bot-shop">The Bot Shop has a new selection. View shop</a>
    <button id="dismissShopAlert" class="btn secondary-btn" type="button">Mark read</button>
    <span id="shopAlertStatus"></span>
  </div>
`;

siteHeader.querySelector('#themeToggle').addEventListener('click', () => window.ledgerTheme.toggle());
window.ledgerTheme.refresh();

const navLinks = {
  home: siteHeader.querySelector('#homeTab'),
  leaderboard: siteHeader.querySelector('#leaderboardTab'),
  profile: siteHeader.querySelector('#profileTab'),
  companions: siteHeader.querySelector('#companionsTab'),
  items: siteHeader.querySelector('#itemsTab'),
  store: siteHeader.querySelector('#storeTab'),
  casino: siteHeader.querySelector('#casinoTab'),
  wiki: siteHeader.querySelector('#wikiTab'),
  developer: siteHeader.querySelector('#developerTab')
};

function setNavCurrent(name) {
  Object.entries(navLinks).forEach(([key, link]) => {
    if (key === name) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

if (location.pathname === '/') {
  setNavCurrent('home');
} else if (location.pathname.startsWith('/leaderboard')) {
  setNavCurrent(new URLSearchParams(location.search).get('view') === 'profile' ? 'profile' : 'leaderboard');
} else if (location.pathname.startsWith('/casino')) {
  setNavCurrent('casino');
} else if (location.pathname.startsWith('/skills')) {
  setNavCurrent('profile');
} else if (location.pathname.startsWith('/companions') || location.pathname.startsWith('/companion')) {
  setNavCurrent('companions');
} else if (location.pathname.startsWith('/items') || location.pathname.startsWith('/item')) {
  setNavCurrent('items');
} else if (location.pathname.startsWith('/store') || location.pathname.startsWith('/auction')) {
  setNavCurrent('store');
} else if (location.pathname.startsWith('/wiki')) {
  setNavCurrent('wiki');
} else if (location.pathname.startsWith('/developer')) {
  setNavCurrent('developer');
}

// The ledger page swaps views in place instead of reloading.
navLinks.leaderboard.addEventListener('click', event => {
  if (typeof showLeaderboard === 'function') {
    event.preventDefault();
    showLeaderboard();
  }
});

navLinks.profile.addEventListener('click', event => {
  if (typeof showOwnProfile === 'function') {
    event.preventDefault();
    showOwnProfile();
  }
});

function showLoginUnavailable() {
  const loginLink = siteHeader.querySelector('#loginLink');
  loginLink.classList.remove('hidden');
  loginLink.textContent = 'Discord login unavailable';
  loginLink.setAttribute('aria-disabled', 'true');
  loginLink.removeAttribute('href');
}

const authReady = fetch('/api/auth/me', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return response.json();
  })
  .then(auth => {
    siteHeader
      .querySelector('#loginLink')
      .classList.toggle('hidden', Boolean(auth.user) || !auth.enabled);
    siteHeader
      .querySelector('#loggedInNav')
      .classList.toggle('hidden', !auth.user);
    siteHeader.querySelector('#developerTab').classList.toggle('hidden', !auth.isDeveloper);

    if (auth.user) {
      siteHeader.querySelector('#accountName').classList.remove('hidden');
      siteHeader.querySelector('#accountName').textContent =
        auth.user.displayName;
    } else if (!auth.enabled) {
      showLoginUnavailable();
    }

    return auth;
  })
  .catch(error => {
    console.error('Could not check Discord login status:', error);
    showLoginUnavailable();
    return { enabled: false, user: null };
  });

let shopAlertGeneration = null;
async function checkShopAlert() {
  try {
    const response = await fetch('/api/bot-shop/alert', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const alert = await response.json();
    shopAlertGeneration = alert.generation;
    siteHeader.querySelector('#shopRestockAlert').classList.toggle('hidden', !alert.unread);
    siteHeader.querySelector('#shopAlertLink').classList.remove('hidden');
    siteHeader.querySelector('#dismissShopAlert').classList.remove('hidden');
    siteHeader.querySelector('#shopAlertStatus').textContent = '';
  } catch (error) {
    console.error('Could not load Bot Shop restock alert:', error);
    siteHeader.querySelector('#shopRestockAlert').classList.remove('hidden');
    siteHeader.querySelector('#shopAlertLink').classList.add('hidden');
    siteHeader.querySelector('#dismissShopAlert').classList.add('hidden');
    siteHeader.querySelector('#shopAlertStatus').textContent = 'Could not load restock alerts.';
  }
}
siteHeader.querySelector('#dismissShopAlert').addEventListener('click', async event => {
  if (!shopAlertGeneration) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch('/api/bot-shop/alert/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ generation: shopAlertGeneration })
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    await checkShopAlert();
  } catch (error) {
    siteHeader.querySelector('#shopAlertStatus').textContent = `Could not mark alert read. ${error.message}`;
  } finally { button.disabled = false; }
});
void authReady.then(auth => {
  if (auth.user) {
    void checkShopAlert();
    window.setInterval(checkShopAlert, 60000);
  }
});
