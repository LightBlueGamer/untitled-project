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
`;

siteHeader.querySelector('#themeToggle').addEventListener('click', () => window.ledgerTheme.toggle());
window.ledgerTheme.refresh();

const navLinks = {
  home: siteHeader.querySelector('#homeTab'),
  leaderboard: siteHeader.querySelector('#leaderboardTab'),
  profile: siteHeader.querySelector('#profileTab'),
  companions: siteHeader.querySelector('#companionsTab'),
  items: siteHeader.querySelector('#itemsTab'),
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
