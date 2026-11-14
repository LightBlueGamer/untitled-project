(() => {
  const form = document.querySelector('#houseLearnSearch');
  const query = document.querySelector('#houseLearnQuery');
  const status = document.querySelector('#houseLearnStatus');
  const players = document.querySelector('#houseLearnPlayers');
  const more = document.querySelector('#houseLearnMore');
  const details = document.querySelector('#houseLearnDetails');
  let search = '';
  let next = null;
  let searchVersion = 0;
  let detailVersion = 0;
  let searching = false;

  function element(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  async function get(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async function searchPlayers(append = false) {
    if (append && searching) return;
    if (!append) {
      search = query.value.trim();
      next = null;
      players.replaceChildren();
      details.replaceChildren();
      detailVersion++;
    }
    const version = ++searchVersion;
    searching = true;
    more.classList.add('hidden');
    status.textContent = 'Loading players…';
    const params = new URLSearchParams({ search });
    if (append && next) params.set('after', next);
    try {
      const data = await get(`/api/developer/house-learns/players?${params}`);
      if (version !== searchVersion) return;
      for (const player of data.players) {
        const button = element('button', `${player.name} (${player.id})${player.learned ? '' : ' · no observations'}`, 'btn secondary-btn');
        button.type = 'button';
        button.addEventListener('click', () => loadPlayer(player.id));
        players.append(button);
      }
      next = data.next;
      more.classList.toggle('hidden', !next);
      status.textContent = players.children.length ? 'Select a player to inspect their profile.' : 'No players found.';
    } catch (error) {
      if (version === searchVersion) status.textContent = `Could not search players: ${error.message}`;
    } finally {
      if (version === searchVersion) searching = false;
    }
  }

  function profileText(profile) {
    const percent = value => profile.actions ? `${(value * 100 / profile.actions).toFixed(1)}%` : 'no observations';
    return `${profile.actions.toLocaleString()} actions · ${profile.raises.toLocaleString()} raises (${percent(profile.raises)}) · ${profile.calls.toLocaleString()} calls/checks (${percent(profile.calls)}) · ${profile.folds.toLocaleString()} folds (${percent(profile.folds)})`;
  }

  async function loadPlayer(id) {
    const version = ++detailVersion;
    details.replaceChildren();
    status.textContent = 'Loading learning profile…';
    try {
      const data = await get(`/api/developer/house-learns/players/${encodeURIComponent(id)}`);
      if (version !== detailVersion) return;
      const panel = element('div', '', 'developer-house-details');
      const percent = value => `${(value * 100).toFixed(2)}%`;
      panel.append(
        element('h3', `${data.name} (${data.id})`),
        element('h4', 'Player observations'),
        element('p', profileText(data.player)),
        element('h4', 'Shared observations across all players'),
        element('p', profileText(data.global)),
        element('h4', 'Current strategy against this player'),
        element('p', `Adjusted raise tendency: ${percent(data.tactics.aggression)}. This adds ${percent(data.tactics.foldAdjustment)} to the bot's estimated hand strength when deciding whether to fold to a bet; a higher value makes it less likely to fold.`),
        element('p', `Adjusted fold tendency: ${percent(data.tactics.foldRate)}. When facing no bet, the bot's bluff draw is ${percent(data.tactics.bluffChance)}; it can only raise when a raise is legal.`),
        element('p', 'These adjusted tendencies combine the player’s counts with 10% of the shared counts (including this player) and smoothing. They are not raw action percentages. Calls and checks are recorded together. The bot also raises strong hands and estimates strength from its own cards and the public board; it does not store individual hands or a history of tactics.', 'muted-note')
      );
      details.append(panel);
      status.textContent = data.player.actions ? 'Learning profile loaded.' : 'No actions recorded for this player; shared data and defaults still influence the strategy.';
    } catch (error) {
      if (version === detailVersion) status.textContent = `Could not load learning profile: ${error.message}`;
    }
  }

  form.addEventListener('submit', event => { event.preventDefault(); void searchPlayers(); });
  more.addEventListener('click', () => { if (next) void searchPlayers(true); });
  void searchPlayers();
})();
