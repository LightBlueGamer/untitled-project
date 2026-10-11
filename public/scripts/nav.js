const siteHeader = document.querySelector('#siteHeader');

siteHeader.className = 'site-header';
siteHeader.innerHTML = `
  <a class="site-brand" href="/">Prestigious Ledger</a>
  <nav id="accountNav" class="account-nav" aria-label="Account navigation">
    <a id="loginLink" class="btn hidden" href="/auth/discord">Login with Discord</a>
    <div id="loggedInNav" class="logged-in-nav hidden">
      <span id="accountName" class="account-name"></span>
      <a id="leaderboardTab" class="nav-link" href="/">Leaderboard</a>
      <a id="profileTab" class="nav-link" href="/?view=profile">Profile</a>
      <a id="casinoTab" class="nav-link" href="/casino">Casino</a>
      <form action="/auth/logout" method="post">
        <button class="nav-link" type="submit">Log out</button>
      </form>
    </div>
  </nav>
`;

const navLinks = {
  leaderboard: siteHeader.querySelector('#leaderboardTab'),
  profile: siteHeader.querySelector('#profileTab'),
  casino: siteHeader.querySelector('#casinoTab')
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

if (location.pathname.startsWith('/casino')) {
  setNavCurrent('casino');
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

    if (auth.user) {
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
