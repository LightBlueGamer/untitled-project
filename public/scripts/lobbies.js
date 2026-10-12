// Multiplayer lobbies for Pass the Bills and Poker. Relies on globals from casino.js.
/* global $, api, format, cell, setBalance, refreshBalance, sound */
(() => {
  const POLL_MS = 1000;
  const FACES = { circle: '⚪', star: '⭐', left: '⬅️', right: '➡️' };
  const STAGES = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  const panel = $('#game-lobbies');
  const browser = $('#lobbyBrowser');
  const room = $('#lobbyRoom');
  const listBody = $('#lobbyList');
  const gameSelect = $('#lobbyGame');
  const betInput = $('#lobbyBet');
  const maxInput = $('#lobbyMax');
  const botsInput = $('#lobbyBots');
  const message = $('#lobbyMessage');

  let current = null;
  let lastSignature = '';
  let clockOffset = 0;
  let raiseTo = 0;
  let lastHand = 0;
  let lastCommunity = 0;
  let busy = false;

  const lobbyApi = (path, method = 'GET', body) =>
    api(`/lobbies${path}`, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(label, handler, className = 'btn') {
    const element = el('button', className, label);
    element.type = 'button';
    element.addEventListener('click', handler);
    return element;
  }

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `plinko-result ${kind}`;
  }

  function isPanelVisible() {
    return !panel.classList.contains('hidden');
  }

  let mode = 'multi';

  function isPoker() {
    return gameSelect.value === 'poker';
  }

  function syncForm() {
    const solo = mode === 'solo';
    const poker = solo || isPoker();
    const maxPlayers = poker ? 6 : 8;
    $('#lobbyBetLabel').textContent = poker ? 'Buy-in (your starting chips)' : 'Bill value (you put down 3)';
    maxInput.max = String(maxPlayers);
    if (Number(maxInput.value) > maxPlayers) maxInput.value = String(maxPlayers);
    $('#lobbyMaxValue').textContent = maxInput.value;
    $('#lobbyBotsValue').textContent = botsInput.value;
    const bet = Number(betInput.value) || 0;
    $('#lobbyCost').textContent = format(poker ? bet : bet * 3);
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll('#lobbyBrowser [data-only]').forEach(node => {
      node.classList.toggle('hidden', node.dataset.only !== mode);
    });
    $('#lobbyCreate').textContent = mode === 'solo' ? 'Play' : 'Create lobby';
    if (mode === 'solo') gameSelect.value = 'poker';
    else if (gameSelect.value !== 'bills' && gameSelect.value !== 'poker') gameSelect.value = 'bills';
    betInput.value = mode === 'solo' || isPoker() ? '200' : '10';
    syncForm();
  }

  gameSelect.addEventListener('change', () => setMode('multi'));
  maxInput.addEventListener('input', syncForm);
  botsInput.addEventListener('input', syncForm);
  betInput.addEventListener('input', () => {
    const cleaned = betInput.value.replace(/\D/g, '');
    if (cleaned !== betInput.value) betInput.value = cleaned;
    syncForm();
  });
  betInput.addEventListener('keydown', event => {
    if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
  });

  document.querySelectorAll('[data-lobby-game]').forEach(card => {
    card.addEventListener('click', () => {
      setMode(card.dataset.lobbyGame);
      if (!current) loadList();
    });
  });

  // Lobby list

  async function loadList() {
    try {
      const data = await lobbyApi('');
      listBody.replaceChildren();
      if (data.lobbies.length === 0) {
        const row = el('tr');
        const td = el('td', 'muted-note', 'No open lobbies yet. Create one!');
        td.colSpan = 5;
        row.append(td);
        listBody.append(row);
        return;
      }
      for (const lobby of data.lobbies) {
        const row = el('tr');
        const action = el('td');
        const game = lobby.game === 'poker' ? 'Poker' : 'Pass the Bills';
        const stake = lobby.game === 'poker'
          ? `${format(lobby.cost)} buy-in`
          : `${format(lobby.cost)} (${format(lobby.bet)} × 3)`;
        if (lobby.joinable) {
          action.append(button('Join', () => join(lobby.id), 'nav-link'));
        } else {
          action.textContent = lobby.status === 'playing' ? 'In progress' : 'Full';
        }
        row.append(
          cell(game),
          cell(lobby.hostName),
          cell(stake),
          cell(`${lobby.players}/${lobby.maxPlayers}`),
          action
        );
        listBody.append(row);
      }
    } catch (error) {
      setMessage(error.message, 'loss');
    }
  }

  async function create() {
    const bet = Number(betInput.value);
    if (!Number.isSafeInteger(bet) || bet < 1) {
      setMessage('Enter a whole number.', 'loss');
      return;
    }
    const solo = mode === 'solo';
    await enter(() => lobbyApi('', 'POST', {
      game: gameSelect.value,
      bet,
      maxPlayers: solo ? Number(botsInput.value) + 1 : Number(maxInput.value),
      bots: solo ? Number(botsInput.value) : 0
    }));
  }

  async function join(id) {
    await enter(() => lobbyApi(`/${id}/join`, 'POST'));
  }

  async function enter(request) {
    if (busy) return;
    busy = true;
    try {
      const data = await request();
      setBalance(data.balance);
      setMessage('');
      show(data.lobby);
    } catch (error) {
      setMessage(error.message, 'loss');
      loadList();
    } finally {
      busy = false;
    }
  }

  async function leave() {
    if (!current) return;
    const id = current.id;
    try {
      await lobbyApi(`/${id}/leave`, 'POST');
    } catch (error) {
      setMessage(error.message, 'loss');
    }
    exitRoom();
    setTimeout(refreshBalance, 400);
    setTimeout(refreshBalance, 8000);
  }

  function exitRoom() {
    current = null;
    lastSignature = '';
    room.classList.add('hidden');
    browser.classList.remove('hidden');
    loadList();
  }

  async function act(action, extra = {}) {
    if (!current || busy) return;
    busy = true;
    try {
      const data = await lobbyApi(`/${current.id}/action`, 'POST', { action, ...extra });
      show(data.lobby);
    } catch (error) {
      setMessage(error.message, 'loss');
      room.querySelector('.lobby-error')?.replaceChildren(error.message);
    } finally {
      busy = false;
    }
  }

  async function start() {
    if (!current || busy) return;
    busy = true;
    try {
      const data = await lobbyApi(`/${current.id}/start`, 'POST');
      show(data.lobby);
    } catch (error) {
      room.querySelector('.lobby-error')?.replaceChildren(error.message);
    } finally {
      busy = false;
    }
  }

  // Rendering

  function cardElement(card) {
    const element = el('div', `bj-card${card.suit === '♥' || card.suit === '♦' ? ' red' : ''}`);
    element.innerHTML = '<span class="corner top"></span><span class="pip"></span><span class="corner bottom"></span>';
    element.querySelectorAll('.corner').forEach(corner => {
      corner.textContent = `${card.rank}\n${card.suit}`;
    });
    element.querySelector('.pip').textContent = card.suit;
    return element;
  }

  const backCard = () => el('div', 'bj-card back');
  const emptyCard = () => el('div', 'bj-card empty');

  function show(lobby) {
    const previous = current;
    current = lobby;
    clockOffset = lobby.now - Date.now();
    const signature = JSON.stringify(lobby, (key, value) =>
      ['now', 'deadline', 'nextHandAt'].includes(key) ? undefined : value);

    browser.classList.add('hidden');
    room.classList.remove('hidden');

    if (signature === lastSignature) return;
    lastSignature = signature;
    render(lobby, previous);
  }

  function header(lobby) {
    const head = el('div', 'lobby-head');
    const title = lobby.game === 'poker' ? 'Poker table' : 'Pass the Bills';
    head.append(el('h3', '', `${title} · hosted by ${hostName(lobby)}`));
    head.append(button('Leave lobby', leave, 'nav-link'));
    return head;
  }

  function hostName(lobby) {
    const members = lobby.game === 'poker' ? lobby.poker.seats : lobby.members;
    return members.find(member => member.id === lobby.hostId)?.name ?? '?';
  }

  function render(lobby, previous) {
    const nodes = [header(lobby)];
    if (lobby.game === 'poker') {
      nodes.push(...renderPoker(lobby, previous));
    } else {
      nodes.push(...renderBills(lobby));
    }
    nodes.push(el('div', 'lobby-error plinko-result loss'));
    room.replaceChildren(...nodes);
    updateTimer();
  }

  function startControls(lobby, minimum) {
    const seated = lobby.game === 'poker' ? lobby.poker.seats.length : lobby.members.length;
    const box = el('div', 'lobby-actions');
    if (lobby.hostId === lobby.you) {
      const startButton = button('Start game', start);
      startButton.disabled = seated < minimum;
      box.append(startButton);
      box.append(el('span', 'muted-note', seated < minimum
        ? `Waiting for players (${seated}/${minimum} needed)…`
        : 'Everyone is in? Start when ready.'));
    } else {
      box.append(el('span', 'muted-note', 'Waiting for the host to start the game…'));
    }
    return box;
  }

  // Pass the Bills

  function renderBills(lobby) {
    const nodes = [];
    const state = lobby.bills;
    const seats = el('div', 'lobby-seats');
    for (const member of lobby.members) {
      const seat = el('div', `lobby-seat${state.turnId === member.id ? ' turn' : ''}${state.winner === member.id ? ' winner' : ''}`);
      seat.append(el('strong', '', member.id === lobby.you ? `${member.name} (you)` : member.name));
      if (lobby.status !== 'waiting') {
        seat.append(el('span', '', `💵 × ${member.bills}`));
      }
      if (member.left) seat.append(el('span', 'muted-note', 'left (auto)'));
      seats.append(seat);
    }
    nodes.push(seats);

    const centre = el('div', 'lobby-centre');
    centre.append(el('span', 'eyebrow', 'Pot'), el('strong', '', format(lobby.pot)));
    centre.append(el('span', 'muted-note', `Each player staked ${format(lobby.stake)}`));
    if (state.lastRoll) {
      const roller = state.lastRoll.id === lobby.you ? 'You' : state.lastRoll.name;
      centre.append(el('div', 'bills-dice', state.lastRoll.dice.map(face => FACES[face]).join(' ')));
      centre.append(el('span', 'muted-note', `${roller} rolled${state.lastRoll.phase === 'final' ? ' for the last bill' : ''}`));
    }
    const status = el('div', 'muted-note');
    centre.append(status);
    nodes.push(centre);

    if (lobby.status === 'waiting') {
      nodes.push(startControls(lobby, 2));
    } else if (lobby.status === 'playing') {
      const turn = lobby.members.find(member => member.id === state.turnId);
      if (state.turnId === lobby.you) {
        status.textContent = state.phase === 'final'
          ? 'You hold the last bill — roll a circle to win!'
          : 'Your turn!';
        nodes.push(button('Roll dice', () => act('roll')));
      } else {
        status.textContent = `${turn?.name ?? '…'} is rolling…`;
      }
      status.append(' ', el('span', 'lobby-timer'));
    } else {
      const winner = lobby.members.find(member => member.id === state.winner);
      const won = state.winner === lobby.you;
      status.textContent = won
        ? `You won the pot of ${format(lobby.pot)}!`
        : `${winner?.name ?? 'Someone'} won the pot of ${format(lobby.pot)}.`;
      status.className = `plinko-result ${won ? 'win' : 'loss'}`;
      if (lobby.pot) {
        (won ? sound.win : sound.lose)();
        setTimeout(refreshBalance, 400);
      }
      nodes.push(button('Back to lobbies', exitRoom));
    }
    return nodes;
  }

  // Poker

  function renderPoker(lobby, previous) {
    const nodes = [];
    const state = lobby.poker;
    const me = state.seats.find(seat => seat.id === lobby.you);

    const table = el('div', 'poker-table');
    const info = el('div', 'poker-info');
    info.append(
      el('span', 'eyebrow', state.handNo ? `Hand #${state.handNo} · ${STAGES[state.stage]}` : 'Not started'),
      el('strong', '', `Pot ${format(state.pot)}`),
      el('span', 'muted-note', `Blinds ${format(state.sb)} / ${format(state.bb)}`)
    );
    table.append(info);

    const community = el('div', 'bj-cards poker-community');
    for (let i = 0; i < 5; i++) {
      community.append(state.community[i] ? cardElement(state.community[i]) : emptyCard());
    }
    table.append(community);
    nodes.push(table);

    if (state.community.length > lastCommunity || (state.handNo !== lastHand && state.active)) {
      sound.card();
    }
    lastCommunity = state.community.length;

    const seats = el('div', 'lobby-seats');
    for (const seat of state.seats) {
      const classes = ['lobby-seat'];
      if (state.turnId === seat.id) classes.push('turn');
      if (seat.folded && seat.inHand) classes.push('folded');
      if (state.result?.winners.some(winner => winner.id === seat.id) && !state.active) classes.push('winner');
      const node = el('div', classes.join(' '));
      const dealer = state.dealerId === seat.id ? ' Ⓓ' : '';
      node.append(el('strong', '', `${seat.id === lobby.you ? `${seat.name} (you)` : seat.name}${dealer}`));
      node.append(el('span', '', `Chips ${format(seat.chips)}`));
      const tags = [];
      if (seat.bet > 0) tags.push(`Bet ${format(seat.bet)}`);
      if (seat.allIn) tags.push('ALL-IN');
      if (seat.folded && seat.inHand) tags.push('Folded');
      if (seat.leaving) tags.push('Leaving');
      if (tags.length) node.append(el('span', 'muted-note', tags.join(' · ')));
      if (seat.inHand) {
        const cards = el('div', 'bj-cards poker-hole');
        if (seat.hole.length) {
          cards.append(...seat.hole.map(cardElement));
        } else {
          cards.append(backCard(), backCard());
        }
        node.append(cards);
      }
      const shownHand = state.result?.hands?.[seat.id];
      if (shownHand && !state.active) node.append(el('span', 'muted-note', shownHand));
      seats.append(node);
    }
    nodes.push(seats);

    const status = el('div', 'poker-status');
    if (state.result && !state.active) {
      const lines = state.result.winners.map(winner => {
        const name = winner.id === lobby.you ? 'You' : state.seats.find(seat => seat.id === winner.id)?.name ?? 'Someone';
        return `${name} won ${format(winner.amount)}${winner.hand ? ` with ${winner.hand}` : ''}`;
      });
      status.append(el('strong', '', lines.join(' · ')));
      status.append(' ', el('span', 'lobby-timer muted-note'));
      if (previous && previous.poker.handNo === state.handNo && previous.poker.active) {
        const won = state.result.winners.some(winner => winner.id === lobby.you);
        if (me?.inHand) (won ? sound.win : sound.lose)();
      }
    }
    lastHand = state.handNo;
    nodes.push(status);

    if (me?.inHand && me.hole.length && state.active) {
      const mine = el('div', 'poker-mine');
      mine.append(el('span', 'eyebrow', 'Your cards'));
      mine.append(...me.hole.map(cardElement));
      nodes.push(mine);
    }

    if (lobby.status === 'waiting') {
      nodes.push(startControls(lobby, 2));
    } else if (state.active && state.turnId === lobby.you && me) {
      nodes.push(actionControls(state, me));
    } else if (state.active) {
      const turn = state.seats.find(seat => seat.id === state.turnId);
      const waiting = el('div', 'muted-note', `Waiting for ${turn?.name ?? '…'}… `);
      waiting.append(el('span', 'lobby-timer'));
      nodes.push(waiting);
    }
    return nodes;
  }

  function actionControls(state, me) {
    const box = el('div', 'lobby-actions');
    box.append(button('Fold', () => act('fold'), 'btn danger'));
    const toCall = state.toCall;
    box.append(button(toCall > 0 ? `Call ${format(toCall)}${toCall >= me.chips ? ' (all-in)' : ''}` : 'Check', () => act('call')));

    if (state.maxTo > state.currentBet) {
      const min = Math.min(state.minRaiseTo, state.maxTo);
      if (raiseTo < min || raiseTo > state.maxTo) raiseTo = min;
      const input = el('input', 'search');
      input.type = 'number';
      input.step = '1';
      input.min = String(min);
      input.max = String(state.maxTo);
      input.value = String(raiseTo);
      input.inputMode = 'numeric';
      input.addEventListener('input', () => {
        raiseTo = Number(input.value.replace(/\D/g, ''));
      });
      input.addEventListener('keydown', event => {
        if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
      });
      const raiseLabel = state.currentBet > 0 ? 'Raise to' : 'Bet';
      box.append(input);
      box.append(button(raiseLabel, () => act('raise', { to: Number(input.value) })));
      box.append(button(`All-in ${format(state.maxTo)}`, () => act('raise', { to: state.maxTo }), 'nav-link'));
    }
    box.append(el('span', 'lobby-timer muted-note'));
    return box;
  }

  function updateTimer() {
    if (!current) return;
    const state = current.game === 'poker' ? current.poker : current.bills;
    let target = 0;
    let label = '';
    if (current.game === 'poker') {
      if (state.active) {
        target = state.deadline;
        label = 'auto-fold in';
      } else if (state.result && current.status === 'playing') {
        target = state.nextHandAt;
        label = 'next hand in';
      }
    } else if (current.status === 'playing') {
      target = state.deadline;
      label = 'auto-roll in';
    }
    const seconds = Math.max(0, Math.ceil((target - (Date.now() + clockOffset)) / 1000));
    room.querySelectorAll('.lobby-timer').forEach(node => {
      node.textContent = target ? `(${label} ${seconds}s)` : '';
    });
  }

  // Polling

  async function poll() {
    try {
      if (current) {
        const data = await lobbyApi(`/${current.id}`);
        show(data.lobby);
      } else if (isPanelVisible()) {
        await loadList();
      }
    } catch (error) {
      if (current && /not found/i.test(error.message)) {
        exitRoom();
        setMessage('That lobby has closed.', 'loss');
        refreshBalance();
      }
    }
  }

  window.setInterval(() => {
    if (!busy) poll();
  }, POLL_MS);
  window.setInterval(updateTimer, 500);

  $('#lobbyCreate').addEventListener('click', create);
  setMode('multi');

  authReady.then(async auth => {
    if (!auth.user) return;
    try {
      const data = await lobbyApi('/mine');
      if (data.lobby) {
        show(data.lobby);
        const card = document.querySelector(`[data-lobby-game="${data.lobby.solo ? 'solo' : 'multi'}"]`);
        card?.click();
      }
    } catch {
      // Not in a lobby.
    }
  });
})();
