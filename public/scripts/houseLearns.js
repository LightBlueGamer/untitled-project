/* global $, api, format, refreshBalance, sound */
(() => {
  const room = $('#houseRoom');
  const status = $('#houseStatus');
  const start = $('#houseStart');
  const wagerInput = $('#houseWager');
  const estimate = $('#houseEstimate');
  let match = null;
  let pool = null;
  let busy = false;
  let deadlineTimer;
  const dealer = window.pokerCards.dealer(() => sound.card(), () => !$('#game-house-learns').classList.contains('hidden'));
  const money = value => `$${BigInt(value).toLocaleString()}`;
  const stages = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', between: 'Hand complete', finished: 'Tournament complete' };

  function updateEstimate() {
    if (pool === null) {
      estimate.textContent = '';
      return;
    }
    const wager = match?.status === 'active' ? String(match.game.wager) : wagerInput.value;
    if (!/^\d+$/.test(wager) || BigInt(wager) < 100n || BigInt(wager) > 4503599627370495n) {
      estimate.textContent = 'Enter a valid wager to see an estimated prize.';
      return;
    }
    const stake = BigInt(wager);
    const proportional = stake * 4n / 3n;
    const minimum = pool / 1000n;
    const share = proportional > minimum ? proportional : minimum;
    const prize = share < pool ? share : pool;
    estimate.textContent = `At the last displayed pool, a win pays ${money(prize)} from the pool plus your ${money(stake)} wager (${money(prize + stake)} total). The pool may change before settlement.`;
  }

  function element(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  function button(label, action, className = 'btn') {
    const node = element('button', label, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function render(data, fresh = false) {
    const previousId = match?.id;
    match = data.match;
    pool = BigInt(data.stats.pool);
    updateEstimate();
    if (previousId && previousId !== match?.id) dealer.reset();
    window.clearTimeout(deadlineTimer);
    if (match?.status === 'active') {
      const delay = Math.max(1000, new Date(match.deadline).getTime() - Date.now() + 1000);
      deadlineTimer = setTimeout(() => window.refreshHouseLearns(), delay);
    }
    $('#housePool').textContent = money(data.stats.pool);
    $('#houseGames').textContent = BigInt(data.stats.games).toLocaleString();
    $('#houseWins').textContent = BigInt(data.stats.houseWins).toLocaleString();
    const active = match?.status === 'active';
    start.classList.toggle('hidden', active);
    room.replaceChildren();
    if (data.pending && BigInt(data.pending) > 0n) {
      room.append(element('p', `${money(data.pending)} is owed to you. It will be credited when your balance has room; refresh this game to claim it.`));
    }
    if (!match) {
      dealer.reset();
      return;
    }
    const game = match.game;
    if (!game) {
      dealer.reset();
      room.append(element('p', match.reason || 'Match unavailable.'));
      return;
    }
    dealer.update(game.hand, game.board.length, ['bot', 'player'], fresh);
    const table = element('div', '', 'poker-table house-poker-table');
    const info = element('div', '', 'poker-info');
    info.append(
      element('span', `Hand #${game.hand} · ${stages[game.stage]}`, 'eyebrow'),
      element('strong', `Pot ${format(game.pot)}`),
      element('span', `Blinds ${format(Math.ceil(game.blind / 2))} / ${format(game.blind)}`, 'muted-note')
    );
    const community = element('div', '', 'bj-cards poker-community');
    community.setAttribute('aria-label', 'Community cards');
    for (let i = 0; i < 5; i++) {
      community.append(game.board[i] ? dealer.decorate(window.pokerCards.face(game.board[i]), `board:${i}`) : window.pokerCards.empty());
    }
    table.append(info, community);
    room.append(table);

    const seats = element('div', '', 'lobby-seats house-poker-seats');
    for (const [name, seat, isPlayer] of [['Prestigious 🤖', game.bot, false], ['You', game.player, true]]) {
      const winner = !active && game.winner === (isPlayer ? 'player' : 'house');
      const currentTurn = active && isPlayer && game.stage !== 'between';
      const node = element('div', '', `lobby-seat${winner ? ' winner' : ''}${currentTurn ? ' turn' : ''}`);
      node.append(element('strong', name), element('span', `Chips ${format(seat.chips)}`));
      if (seat.bet > 0) node.append(element('span', `Bet ${format(seat.bet)}`, 'muted-note'));
      const cards = element('div', '', 'bj-cards poker-hole');
      cards.setAttribute('aria-label', `${name} cards`);
      const id = isPlayer ? 'player' : 'bot';
      const hole = seat.hole.length ? seat.hole.map(window.pokerCards.face) : [window.pokerCards.back(), window.pokerCards.back()];
      cards.append(...hole.map((card, i) => dealer.decorate(card, `hole:${id}:${i}`)));
      node.append(cards);
      if (isPlayer && game.player.currentHand) node.append(element('span', `Current hand: ${game.player.currentHand}`, 'muted-note'));
      seats.append(node);
    }
    room.append(seats);
    const result = element('div', '', 'poker-status');
    result.append(element('strong', game.message));
    room.append(result);
    if (!active) {
      room.append(element('p', `${match.reason || 'Match finished.'} ${match.status === 'player' ? `Prize: ${money(match.payout)}.` : ''}${BigInt(match.unclaimed) > 0n ? ` ${money(match.unclaimed)} remains to be credited.` : ''}`));
      return;
    }
    result.append(element('span', `Turn expires: ${new Date(match.deadline).toLocaleTimeString()}`, 'muted-note'));
    const actions = element('div', '', 'lobby-actions');
    if (game.stage === 'between') {
      actions.append(button('Next hand', () => act('next')));
    } else {
      actions.append(button('Fold', () => act('fold'), 'btn danger'));
      actions.append(button(game.toCall ? `Call ${format(game.toCall)}${game.toCall >= game.player.chips ? ' (all-in)' : ''}` : 'Check', () => act('call')));
      if (game.maxRaiseTo > Math.max(game.player.bet, game.bot.bet)) {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'search';
        input.min = String(Math.min(game.minRaiseTo, game.maxRaiseTo));
        input.max = String(game.maxRaiseTo);
        input.step = '1';
        input.value = input.min;
        input.inputMode = 'numeric';
        input.setAttribute('aria-label', 'Raise to');
        actions.append(input, button('Raise to', () => act('raise', Number(input.value))),
          button(`All-in ${format(game.maxRaiseTo)}`, () => act('raise', game.maxRaiseTo), 'nav-link'));
      }
    }
    actions.append(button('Forfeit match', () => {
      if (window.confirm('Forfeit the tournament and add your wager to the prize pool?')) act('forfeit');
    }, 'nav-link'));
    room.append(actions);
  }

  window.refreshHouseLearns = async (preserveStatus = false) => {
    if (busy) return;
    busy = true;
    try {
      const data = await api('/house-learns');
      render(data);
      if (data.claimed) await refreshBalance();
      if (!preserveStatus) status.textContent = '';
    } catch (error) {
      status.textContent = `Could not load The House Learns: ${error.message}`;
    } finally { busy = false; }
  };

  async function act(action, amount) {
    if (busy || !match) return;
    busy = true;
    try {
      const data = await api(`/house-learns/${encodeURIComponent(match.id)}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ action, amount, revision: match.revision }),
      });
      if (data.expired) {
        status.textContent = 'Your turn expired. Refreshing match status.';
      } else {
        render(data);
        status.textContent = '';
      }
      await refreshBalance();
    } catch (error) {
      status.textContent = `${error.message} Refresh the game to check its current state.`;
    } finally {
      busy = false;
    }
    await window.refreshHouseLearns(true);
  }

  $('#housePlay').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      const data = await api('/house-learns/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ wager: Number(wagerInput.value) }),
      });
      render(data, true);
      status.textContent = '';
      await refreshBalance();
    } catch (error) {
      status.textContent = `${error.message} Refresh the game to check its current state.`;
    } finally { busy = false; }
  });
  $('#houseRefresh').addEventListener('click', () => window.refreshHouseLearns());
  wagerInput.addEventListener('input', updateEstimate);
})();
