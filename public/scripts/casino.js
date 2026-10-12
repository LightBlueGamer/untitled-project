const $ = selector => document.querySelector(selector);

const balanceElement = $('#casinoBalance');
const resultElement = $('#plinkoResult');
const historyElement = $('#plinkoHistory');
const dropButton = $('#plinkoDrop');
const autoButton = $('#plinkoAuto');
const betInput = $('#plinkoBet');
const rowsInput = $('#plinkoRows');
const ballsInput = $('#plinkoBalls');
const totalElement = $('#plinkoTotal');
const canvas = $('#plinkoCanvas');
const context = canvas.getContext('2d');

const STEP_MS = 480;
const MAX_STAGGER_MS = 4000;
const speedInput = $('#plinkoSpeed');
const speedValue = $('#plinkoSpeedValue');
const autoIntervalMs = () => 1000 / Number(speedInput.value);
speedInput.addEventListener('input', () => {
  speedValue.textContent = speedInput.value;
});

let balance = 0;
let risk = 'medium';
let multipliers = [];
let activeBalls = [];
let slotFlash = {};
let loadToken = 0;

const format = value => `$${Number(value).toLocaleString()}`;

// Sounds are synthesised with the Web Audio API, so no audio files are needed.
const sound = (() => {
  let audio = null;
  let muted = localStorage.getItem('casinoMuted') === '1';
  let lastTick = 0;
  const toggle = $('#soundToggle');

  function syncToggle() {
    toggle.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
    toggle.setAttribute('aria-pressed', String(!muted));
  }

  function context() {
    if (muted) {
      return null;
    }
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') {
      audio.resume();
    }
    return audio;
  }

  function tone(freq, duration, { type = 'sine', volume = 0.15, delay = 0, slideTo = null } = {}) {
    const ctx = context();
    if (!ctx) {
      return;
    }
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, start);
    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    }
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noise(duration, { volume = 0.12, delay = 0, frequency = 2500 } = {}) {
    const ctx = context();
    if (!ctx) {
      return;
    }
    const start = ctx.currentTime + delay;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(start);
  }

  toggle.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('casinoMuted', muted ? '1' : '0');
    syncToggle();
    if (!muted) {
      tone(660, 0.12, { type: 'triangle' });
    }
  });
  syncToggle();

  return {
    // Rate limited so dozens of balls don't turn into a wall of noise.
    peg() {
      const now = performance.now();
      if (now - lastTick < 45) {
        return;
      }
      lastTick = now;
      tone(700 + Math.random() * 500, 0.05, { type: 'triangle', volume: 0.06 });
    },
    land(multiplier) {
      const pitch = multiplier >= 1 ? 520 + Math.min(multiplier, 10) * 40 : 260;
      tone(pitch, 0.18, { type: 'sine', volume: 0.12, slideTo: pitch * 1.5 });
    },
    drop() {
      tone(500, 0.15, { type: 'sine', volume: 0.1, slideTo: 250 });
    },
    card() {
      noise(0.07, { volume: 0.14, frequency: 3500 });
      tone(180, 0.05, { type: 'triangle', volume: 0.05 });
    },
    chip() {
      tone(1200, 0.08, { type: 'square', volume: 0.04 });
      tone(1600, 0.1, { type: 'square', volume: 0.04, delay: 0.05 });
    },
    win(big = false) {
      [523, 659, 784, ...(big ? [1047, 1319] : [])].forEach((freq, i) => {
        tone(freq, 0.22, { type: 'triangle', volume: 0.14, delay: i * 0.1 });
      });
    },
    lose() {
      tone(330, 0.3, { type: 'sawtooth', volume: 0.08, slideTo: 110 });
      tone(247, 0.4, { type: 'sawtooth', volume: 0.08, slideTo: 82, delay: 0.18 });
    },
    push() {
      tone(440, 0.18, { type: 'triangle', volume: 0.12 });
      tone(440, 0.18, { type: 'triangle', volume: 0.12, delay: 0.2 });
    }
  };
})();

function formatMultiplier(value) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  if (value >= 100) {
    return String(Math.round(value));
  }
  return String(Number(value.toFixed(value >= 10 ? 1 : 2)));
}

function setBalance(value) {
  balance = Number(value);
  balanceElement.textContent = format(balance);
}

function showMessage(text, kind = '') {
  resultElement.textContent = text;
  resultElement.className = `plinko-result ${kind}`;
}

function currentRows() {
  return Number(rowsInput.value);
}

function updateTotals() {
  const bet = Number(betInput.value) || 0;
  const balls = Number(ballsInput.value);
  $('#plinkoRowsValue').textContent = rowsInput.value;
  $('#plinkoBallsValue').textContent = ballsInput.value;
  totalElement.textContent = format(bet * balls);
}

async function api(path, options) {
  const response = await fetch(`/api/casino${path}`, {
    cache: 'no-store',
    ...options
  });
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Login required');
  }
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

function geometry() {
  const rows = currentRows();
  const slots = rows + 1;
  // All sizes were tuned for a 1500px-wide canvas.
  const k = canvas.height / 1300;
  const top = 50 * k;
  const slotHeight = 150 * k;
  const spacingX = (canvas.width - 20 * k) / slots;
  const spacingY = (canvas.height - top - slotHeight - 40 * k) / rows;
  return {
    k,
    rows,
    slots,
    top,
    slotHeight,
    spacingX,
    spacingY,
    pegRadius: Math.max(9 * k, Math.min(22 * k, spacingX / 4)),
    ballRadius: Math.max(8 * k, Math.min(18 * k, spacingX / 4))
  };
}

// A ball rests on peg (level, offset) and falls onto one of the two pegs below it.
function pegPosition(g, level, offset) {
  return {
    x: canvas.width / 2 + (offset - level / 2) * g.spacingX,
    y: g.top + level * g.spacingY
  };
}

function slotColor(index, rows, light = 58) {
  const t = Math.abs(index - rows / 2) / (rows / 2);
  return `hsl(${Math.round(55 - 55 * t)}, 85%, ${light}%)`;
}

function drawBackground() {
  const gradient = context.createRadialGradient(
    canvas.width / 2, 0, 20,
    canvas.width / 2, canvas.height / 2, canvas.height
  );
  gradient.addColorStop(0, '#2d2340');
  gradient.addColorStop(1, '#0d0b14');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPegs(g) {
  context.save();
  context.shadowColor = '#ffd986';
  context.shadowBlur = 8;
  context.fillStyle = '#f7f0e2';
  for (let level = 0; level < g.rows; level++) {
    for (let peg = 0; peg <= level; peg++) {
      const { x, y } = pegPosition(g, level, peg);
      context.beginPath();
      context.arc(x, y, g.pegRadius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

function roundedRect(x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawSlots(g, now) {
  const slotY = g.top + g.rows * g.spacingY + 18 * g.k;
  const width = g.spacingX - 4;

  const showSign = width >= 85 * g.k;
  const labels = multipliers.map((multiplier) => (
    showSign ? `${formatMultiplier(multiplier)}×` : formatMultiplier(multiplier)
  ));
  const longest = Math.max(...labels.map((label) => label.length));
  const fontSize = Math.min(110 * g.k, g.slotHeight * 0.5, (width - 10 * g.k) / (longest * 0.68));

  multipliers.forEach((multiplier, index) => {
    const label = labels[index];
    const x = canvas.width / 2 + (index - g.rows / 2) * g.spacingX;
    const age = now - (slotFlash[index] ?? -Infinity);
    const flash = Math.max(0, 1 - age / 500);
    const drop = flash * 6;

    const gradient = context.createLinearGradient(0, slotY, 0, slotY + g.slotHeight);
    gradient.addColorStop(0, slotColor(index, g.rows, 62 + flash * 15));
    gradient.addColorStop(1, slotColor(index, g.rows, 38));

    context.save();
    if (flash > 0) {
      context.shadowColor = slotColor(index, g.rows);
      context.shadowBlur = 18 * flash;
    }
    context.fillStyle = gradient;
    roundedRect(x - width / 2, slotY + drop, width, g.slotHeight, 6 * g.k);
    context.fill();
    context.restore();

    context.font = `900 ${fontSize}px Arial`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, fontSize / 8);
    context.strokeStyle = '#120d1a';
    context.fillStyle = '#ffffff';
    context.strokeText(
      label,
      x,
      slotY + drop + g.slotHeight / 2
    );
    context.fillText(
      label,
      x,
      slotY + drop + g.slotHeight / 2
    );
  });
}

function drawBalls(g) {
  activeBalls.forEach(ball => {
    if (!ball.visible) {
      return;
    }

    ball.trail.forEach((point, index) => {
      const fade = (index + 1) / (ball.trail.length + 1);
      context.fillStyle = `rgba(255, 217, 134, ${fade * 0.35})`;
      context.beginPath();
      context.arc(point.x, point.y, g.ballRadius * fade, 0, Math.PI * 2);
      context.fill();
    });

    context.save();
    context.shadowColor = '#ffd986';
    context.shadowBlur = 14;
    const shine = context.createRadialGradient(
      ball.x - 2, ball.y - 2, 1,
      ball.x, ball.y, g.ballRadius
    );
    shine.addColorStop(0, '#fff6d6');
    shine.addColorStop(1, '#e8a93c');
    context.fillStyle = shine;
    context.beginPath();
    context.arc(ball.x, ball.y, g.ballRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  });
}

function draw(now = performance.now()) {
  const g = geometry();
  drawBackground();
  drawPegs(g);
  drawSlots(g, now);
  drawBalls(g);
}

function positionBall(ball, g, elapsed) {
  const progress = Math.min(elapsed / STEP_MS, ball.path.length);
  const step = Math.min(Math.floor(progress), ball.path.length - 1);
  const fraction = progress - step;
  const offset = ball.path.slice(0, step).reduce((sum, value) => sum + value, 0);
  const from = pegPosition(g, step, offset);
  const to = pegPosition(g, step + 1, offset + ball.path[step]);
  const hop = Math.sin(fraction * Math.PI) * g.spacingY * 0.22;
  const lift = g.pegRadius + g.ballRadius;

  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction * fraction - hop - lift * (1 - fraction)
  };
}

function addHistory(multiplier, payout, bet) {
  const chip = document.createElement('span');
  chip.className = `history-chip ${payout >= bet ? 'win' : 'loss'}`;
  chip.textContent = `${formatMultiplier(multiplier)}×`;
  historyElement.prepend(chip);
  while (historyElement.children.length > 12) {
    historyElement.lastElementChild.remove();
  }
}

let loopRunning = false;

function frame(now) {
  const g = geometry();

  activeBalls.forEach(ball => {
    if (ball.landed) {
      return;
    }
    const elapsed = now - ball.start;
    if (elapsed < 0) {
      return;
    }

    ball.visible = true;
    const step = Math.floor(elapsed / STEP_MS);
    if (step !== ball.lastStep && step > 0 && step < ball.path.length) {
      sound.peg();
    }
    ball.lastStep = step;
    if (elapsed >= ball.path.length * STEP_MS) {
      ball.landed = true;
      ball.visible = false;
      slotFlash[ball.slot] = now;
      sound.land(ball.multiplier);
      setBalance(balance + ball.payout);
      addHistory(ball.multiplier, ball.payout, ball.bet);
      return;
    }

    const position = positionBall(ball, g, elapsed);
    ball.trail.push({ x: ball.x || position.x, y: ball.y || position.y });
    if (ball.trail.length > 6) {
      ball.trail.shift();
    }
    ball.x = position.x;
    ball.y = position.y;
  });

  draw(now);

  waiters = waiters.filter(waiter => {
    if (waiter.batch.every(ball => ball.landed)) {
      waiter.resolve();
      return false;
    }
    return true;
  });
  activeBalls = activeBalls.filter(ball => !ball.landed);

  if (activeBalls.length > 0) {
    requestAnimationFrame(frame);
  } else {
    loopRunning = false;
  }
}

let waiters = [];

function playDrops(drops, bet, stagger = Math.min(400, MAX_STAGGER_MS / drops.length)) {
  const startedAt = performance.now();
  const batch = drops.map((drop, index) => ({
    ...drop,
    bet,
    start: startedAt + index * stagger,
    visible: false,
    landed: false,
    trail: [],
    x: 0,
    y: 0
  }));
  activeBalls.push(...batch);

  return new Promise(resolve => {
    waiters.push({ batch, resolve });
    if (!loopRunning) {
      loopRunning = true;
      requestAnimationFrame(frame);
    }
  });
}
function setControlsDisabled(disabled) {
  document
    .querySelectorAll('.plinko-controls button, .plinko-controls input')
    .forEach(control => {
      control.disabled = disabled && control !== autoButton && control !== speedInput;
    });
}

async function refreshBalance() {
  try {
    const data = await api('/balance');
    setBalance(data.balance);
  } catch (error) {
    balanceElement.textContent = 'Unavailable';
    showMessage(error.message, 'loss');
  }
}

let autoRunning = false;

async function drop(auto = false) {
  const bet = Number(betInput.value);
  const balls = auto === true ? 1 : Number(ballsInput.value);
  let ok = false;

  if (!Number.isSafeInteger(bet) || bet < 1) {
    showMessage('Enter a whole number bet of at least 1.', 'loss');
    return false;
  }
  if (bet * balls > balance) {
    showMessage(
      auto === true
        ? 'Auto drop stopped: not enough balance.'
        : 'You do not have enough balance for that total bet.',
      'loss'
    );
    return false;
  }

  sound.drop();

  setControlsDisabled(true);
  showMessage('');

  try {
    const result = await api('/plinko', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet, balls, rows: currentRows(), risk })
    });

    multipliers = result.multipliers;
    setBalance(balance - result.totalBet);
    await playDrops(result.drops, bet);
    setBalance(result.balance);

    const net = result.totalPayout - result.totalBet;
    const summary = `${balls} ball${balls === 1 ? '' : 's'}: paid ${format(result.totalPayout)}`;
    if (net > 0) {
      showMessage(`${summary} — you won ${format(net)}!`, 'win');
    } else if (net === 0) {
      showMessage(`${summary} — you broke even.`);
    } else {
      showMessage(`${summary} — you lost ${format(-net)}.`, 'loss');
    }
    ok = true;
  } catch (error) {
    showMessage(error.message, 'loss');
    await refreshBalance();
  } finally {
    setControlsDisabled(autoRunning);
    draw();
  }
  return ok;
}

async function toggleAuto() {
  if (autoRunning) {
    autoRunning = false;
    autoButton.textContent = 'Stopping…';
    return;
  }

  const bet = Number(betInput.value);
  if (!Number.isSafeInteger(bet) || bet < 1) {
    showMessage('Enter a whole number bet of at least 1.', 'loss');
    return;
  }

  autoRunning = true;
  autoButton.textContent = 'Stop auto';
  setControlsDisabled(true);
  showMessage('');

  const pending = [];
  let net = 0;
  let count = 0;
  let stopReason = '';

  // Balls are released at the same rate as a 50-ball drop, without waiting for earlier ones to land.
  while (autoRunning) {
    if (bet > balance) {
      stopReason = 'Auto drop stopped: not enough balance.';
      break;
    }
    setBalance(balance - bet);
    try {
      const result = await api('/plinko', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bet, balls: 1, rows: currentRows(), risk })
      });
      multipliers = result.multipliers;
      sound.drop();
      net += result.totalPayout - result.totalBet;
      count++;
      pending.push(playDrops(result.drops, bet));
    } catch (error) {
      setBalance(balance + bet);
      stopReason = error.message;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, autoIntervalMs()));
  }

  await Promise.all(pending);
  await refreshBalance();
  autoRunning = false;
  autoButton.textContent = 'Auto drop';
  setControlsDisabled(false);

  const summary = `Auto drop: ${count} ball${count === 1 ? '' : 's'}`;
  if (stopReason) {
    showMessage(`${stopReason} ${summary}, net ${net >= 0 ? '+' : '-'}${format(Math.abs(net))}.`, 'loss');
  } else {
    showMessage(
      `${summary}, net ${net >= 0 ? '+' : '-'}${format(Math.abs(net))}.`,
      net > 0 ? 'win' : net < 0 ? 'loss' : ''
    );
  }
}
async function loadMultipliers() {
  const token = ++loadToken;
  try {
    const data = await api(`/plinko?rows=${currentRows()}&risk=${risk}`);
    if (token === loadToken) {
      multipliers = data.multipliers;
      slotFlash = {};
      draw();
    }
  } catch (error) {
    showMessage(error.message, 'loss');
  }
}

function selectGame(name, selected) {
  document.querySelectorAll('.game-card').forEach(card => {
    card.setAttribute('aria-selected', String(selected ? card === selected : card.dataset.game === name));
  });
  document.querySelectorAll('.game-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `game-${name}`);
  });
  if (name === 'leaderboard') {
    loadLeaderboard();
  }
}

let leaderboardSort = 'net';

const signed = value => `${value >= 0 ? '+' : '-'}${format(Math.abs(value))}`;
const tone = value => (value > 0 ? 'win' : value < 0 ? 'loss' : '');

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) {
    td.className = className;
  }
  return td;
}

function fillRows(body, rows, empty) {
  body.replaceChildren();
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = cell(empty, 'muted-note');
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
    return;
  }
  rows.forEach(cells => {
    const tr = document.createElement('tr');
    tr.append(...cells);
    body.append(tr);
  });
}

async function loadLeaderboard() {
  try {
    const data = await api(`/stats?sort=${leaderboardSort}`);
    const { house } = data;

    // The house wins what players lose, so its balance is the players' combined loss.
    const net = $('#houseNet');
    net.textContent = signed(house.net);
    net.className = tone(house.net);
    $('#houseNote').textContent = house.net >= 0 ? 'House is up' : 'House is down';
    $('#houseWagered').textContent = format(house.wagered);
    $('#housePaid').textContent = format(house.paidOut);
    $('#houseRounds').textContent = house.rounds.toLocaleString();

    fillRows(
      $('#lbPlayers'),
      data.leaders.map((row, index) => [
        cell(index + 1),
        cell(row.name),
        cell(signed(row.net), tone(row.net)),
        cell(format(row.wagered)),
        cell(row.rounds.toLocaleString())
      ]),
      'No bets placed yet.'
    );
    fillRows(
      $('#lbWins'),
      data.biggestWins.map((row, index) => [
        cell(index + 1),
        cell(row.name),
        cell(row.game === 'plinko' ? 'Plinko' : row.game === 'bills' ? 'Pass the Bills' : row.game === 'poker' ? 'Poker' : 'Blackjack'),
        cell(format(row.bet)),
        cell(format(row.payout), 'win'),
        cell(`${formatMultiplier(row.multiplier)}×`)
      ]),
      'No wins yet.'
    );
  } catch (error) {
    showMessage(error.message, 'loss');
  }
}

document.querySelectorAll('[data-lbsort]').forEach(button => {
  button.addEventListener('click', () => {
    leaderboardSort = button.dataset.lbsort;
    document.querySelectorAll('[data-lbsort]').forEach(other => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    loadLeaderboard();
  });
});

document.querySelectorAll('.game-card').forEach(card => {
  card.addEventListener('click', () => selectGame(card.dataset.game, card));
});

document.querySelectorAll('[data-risk]').forEach(button => {
  button.addEventListener('click', () => {
    risk = button.dataset.risk;
    document.querySelectorAll('[data-risk]').forEach(other => {
      other.setAttribute('aria-checked', String(other === button));
    });
    loadMultipliers();
  });
});

document.querySelectorAll('[data-bet]').forEach(button => {
  button.addEventListener('click', () => {
    const current = Number(betInput.value) || 1;
    const balls = Number(ballsInput.value);
    const next = {
      half: Math.floor(current / 2),
      double: current * 2,
      max: Math.floor(balance / balls)
    }[button.dataset.bet];
    betInput.value = Math.max(1, next);
    updateTotals();
  });
});

rowsInput.addEventListener('input', () => {
  updateTotals();
  loadMultipliers();
});
ballsInput.addEventListener('input', updateTotals);
betInput.addEventListener('input', updateTotals);
dropButton.addEventListener('click', () => drop());
autoButton.addEventListener('click', toggleAuto);

// Blackjack
(() => {
  const dealerElement = $('#bjDealer');
  const playerElement = $('#bjPlayer');
  const dealerTotal = $('#bjDealerTotal');
  const playerTotal = $('#bjPlayerTotal');
  const bjResult = $('#bjResult');
  const bjBetInput = $('#bjBet');
  const betControls = $('#bjBetControls');
  const actions = $('#bjActions');
  const dealButton = $('#bjDeal');
  const doubleButton = $('#bjDouble');
  const buttons = document.querySelectorAll('#game-blackjack button');

  const OUTCOMES = {
    blackjack: ['Blackjack!', 'win', 'Pays 3:2'],
    win: ['You win!', 'win', ''],
    push: ['Push', 'push', 'Your bet is returned'],
    lose: ['Dealer wins', 'loss', ''],
    bust: ['Bust!', 'loss', 'You went over 21']
  };
  const banner = $('#bjBanner');
  const bannerTitle = $('#bjBannerTitle');
  const bannerAmount = $('#bjBannerAmount');
  const betShown = $('#bjBetShown');

  function showBjMessage(text, kind = '') {
    bjResult.textContent = text;
    bjResult.className = `plinko-result ${kind}`;
  }

  // Only newly dealt cards animate, so a hit doesn't replay the whole table.
  let shown = { dealer: 0, player: 0, finished: true };

  function cardElement(card, index, animateFrom) {
    const element = document.createElement('div');
    const red = card.suit === '♥' || card.suit === '♦';
    const isNew = index >= animateFrom;
    element.className = `bj-card${red ? ' red' : ''}${isNew ? ' dealt' : ''}`;
    if (isNew) {
      element.style.animationDelay = `${(index - animateFrom) * 120}ms`;
    }
    element.innerHTML = '<span class="corner top"></span><span class="pip"></span><span class="corner bottom"></span>';
    element.querySelectorAll('.corner').forEach(corner => {
      corner.textContent = `${card.rank}\n${card.suit}`;
    });
    element.querySelector('.pip').textContent = card.suit;
    return element;
  }

  function hiddenCard(index, animateFrom) {
    const element = document.createElement('div');
    element.className = `bj-card back${index >= animateFrom ? ' dealt' : ''}`;
    return element;
  }

  function render(game) {
    const from = shown.finished ? { dealer: 0, player: 0 } : shown;
    const newCards = game.dealer.length + (game.dealerHidden ? 1 : 0) - from.dealer
      + game.player.length - from.player;
    for (let i = 0; i < newCards; i++) {
      setTimeout(sound.card, i * 120);
    }
    dealerElement.replaceChildren(
      ...game.dealer.map((card, index) => cardElement(card, index, from.dealer)),
      ...(game.dealerHidden ? [hiddenCard(game.dealer.length, from.dealer)] : [])
    );
    playerElement.replaceChildren(
      ...game.player.map((card, index) => cardElement(card, index, from.player))
    );
    shown = {
      dealer: game.dealer.length + (game.dealerHidden ? 1 : 0),
      player: game.player.length,
      finished: !game.active
    };
    dealerTotal.textContent = game.dealerHidden ? `${game.dealerTotal} + ?` : game.dealerTotal;
    playerTotal.textContent = game.playerTotal;
    betShown.textContent = format(game.bet);

    betControls.classList.toggle('hidden', game.active);
    actions.classList.toggle('hidden', !game.active);
    doubleButton.disabled = !game.canDouble || game.balance < game.bet;
    setBalance(game.balance);

    banner.classList.add('hidden');
    banner.className = 'bj-banner hidden';
    bjResult.textContent = '';

    if (!game.active && game.outcome) {
      const [title, kind, note] = OUTCOMES[game.outcome];
      const net = game.payout - game.bet;
      setTimeout(() => {
        if (net > 0) {
          sound.win(game.outcome === 'blackjack');
        } else if (net < 0) {
          sound.lose();
        } else {
          sound.push();
        }
      }, Math.max(0, (game.player.length + game.dealer.length - from.player - from.dealer) * 120));
      bannerTitle.textContent = title;
      bannerAmount.textContent = net > 0
        ? `+${format(net)}`
        : net < 0 ? `−${format(-net)}` : format(0);
      banner.className = `bj-banner ${kind}`;
      showBjMessage(
        net > 0
          ? `You won ${format(net)}${note ? ` (${note})` : ''}`
          : net < 0 ? `You lost ${format(-net)}${note ? ` (${note})` : ''}` : note,
        kind === 'push' ? '' : kind
      );
    }
  }

  function setBusy(disabled) {
    buttons.forEach(button => {
      button.disabled = disabled;
    });
  }

  async function send(path, body) {
    setBusy(true);
    try {
      const game = await api(`/blackjack${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      setBusy(false);
      render(game);
    } catch (error) {
      setBusy(false);
      showBjMessage(error.message, 'loss');
    }
  }

  dealButton.addEventListener('click', () => {
    const bet = Number(bjBetInput.value);
    if (!Number.isSafeInteger(bet) || bet < 1) {
      showBjMessage('Enter a whole number bet of at least 1.', 'loss');
      return;
    }
    if (bet > balance) {
      showBjMessage('You do not have enough balance for that bet.', 'loss');
      return;
    }
    showBjMessage('');
    sound.chip();
    send('/start', { bet });
  });

  $('#bjHit').addEventListener('click', () => send('/action', { action: 'hit' }));
  $('#bjStand').addEventListener('click', () => send('/action', { action: 'stand' }));
  doubleButton.addEventListener('click', () => send('/action', { action: 'double' }));

  document.querySelectorAll('[data-bjbet]').forEach(button => {
    button.addEventListener('click', () => {
      const current = Number(bjBetInput.value) || 1;
      const next = {
        half: Math.floor(current / 2),
        double: current * 2,
        max: balance
      }[button.dataset.bjbet];
      bjBetInput.value = Math.max(1, next);
    });
  });

  // Resume a hand left open from a previous visit.
  window.resumeBlackjack = async () => {
    try {
      const game = await api('/blackjack');
      if (game.active) {
        render(game);
        selectGame('blackjack');
      }
    } catch (error) {
      showBjMessage(error.message, 'loss');
    }
  };
})();

// Pass the Bills
(() => {
  const betInput = $('#billsBet');
  const playersInput = $('#billsPlayers');
  const playButton = $('#billsPlay');
  const seatsElement = $('#billsSeats');
  const diceElement = $('#billsDice');
  const statusElement = $('#billsStatus');
  const resultElement = $('#billsResult');
  const potElement = $('#billsPot');
  const autoInput = $('#billsAuto');
  const rollButton = $('#billsRoll');
  let names = [];
  const TURN_MS = 700;
  const MIN_TURN_MS = 90;
  // Each step is a bit quicker than the last so long games don't drag.
  const stepDelay = step => Math.max(MIN_TURN_MS, TURN_MS * Math.pow(0.93, step));
  const FACES = { circle: '⚪', star: '⭐', left: '⬅️', right: '➡️' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const seatName = seat => names[seat] ?? (seat === 0 ? 'You' : `Player ${seat + 1}`);

  function renderSeats(count, bills, active = -1, winner = -1) {
    seatsElement.innerHTML = '';
    seatsElement.style.setProperty('--seats', count);
    for (let seat = 0; seat < count; seat++) {
      const element = document.createElement('div');
      element.className = 'bills-seat';
      element.classList.toggle('active', seat === active);
      element.classList.toggle('winner', seat === winner);
      element.classList.toggle('you', seat === 0);
      const name = document.createElement('span');
      name.className = 'eyebrow';
      name.textContent = seatName(seat);
      const stack = document.createElement('strong');
      stack.textContent = bills[seat] > 0 ? '💵'.repeat(bills[seat]) : '—';
      element.append(name, stack);
      seatsElement.append(element);
    }
  }

  function showDice(faces) {
    diceElement.textContent = faces.map(face => FACES[face]).join(' ');
  }

  function setMessage(text, kind = '') {
    resultElement.textContent = text;
    resultElement.className = `plinko-result ${kind}`;
  }

  function waitForRoll() {
    if (autoInput.checked) {
      return sleep(400);
    }
    statusElement.textContent += ' — your turn!';
    rollButton.classList.remove('hidden');
    return new Promise(resolve => {
      const finish = () => {
        rollButton.removeEventListener('click', finish);
        autoInput.removeEventListener('change', finish);
        rollButton.classList.add('hidden');
        resolve();
      };
      rollButton.addEventListener('click', finish);
      autoInput.addEventListener('change', finish);
    });
  }

  const MULTIPLIERS = [1, 1.25, 1.5, 1.75, 2, 4];

  function updatePreview() {
    const bet = Math.max(0, Number(betInput.value) || 0);
    const players = Number(playersInput.value);
    const multiplier = MULTIPLIERS[players - 3];
    const stake = bet * 3;
    $('#billsPlayersValue').textContent = players;
    $('#billsTotal').textContent = format(stake);
    $('#billsMultiplier').textContent = `${multiplier}×`;
    $('#billsPossible').textContent = format(Math.floor(stake * players * multiplier));
  }

  async function play() {
    const bet = Number(betInput.value);
    const players = Number(playersInput.value);
    if (!Number.isInteger(bet) || bet < 1) {
      setMessage('Bill value must be a whole number of at least 1', 'loss');
      return;
    }
    playButton.disabled = true;
    setMessage('');
    statusElement.textContent = '';
    try {
      const game = await api('/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bet, players })
      });
      names = game.names;
      sound.chip();
      setBalance(game.balance - game.payout);
      potElement.textContent = format(game.pot);
      let bills = Array(players).fill(game.startBills);
      renderSeats(players, bills);
      await sleep(400);

      // When the player loses, stop animating once they can no longer be involved.
      let lastInvolved = Infinity;
      if (game.winner !== 0) {
        const finaleIndex = game.finale.map(roll => roll.seat).lastIndexOf(0);
        if (finaleIndex >= 0) {
          lastInvolved = game.turns.length + finaleIndex;
        } else {
          let idx = -1;
          game.turns.forEach((turn, i) => {
            if (turn.seat === 0 || turn.bills[0] > 0) {
              idx = i;
            }
          });
          lastInvolved = idx;
        }
      }
      let step = 0;
      let skipped = false;

      for (const turn of game.turns) {
        if (step > lastInvolved) {
          skipped = true;
          break;
        }
        const delay = stepDelay(step++);
        renderSeats(players, bills, turn.seat);
        statusElement.textContent = `${seatName(turn.seat)} rolls`;
        if (turn.seat === 0) {
          showDice([]);
          await waitForRoll();
        }
        showDice(turn.dice);
        sound.card();
        await sleep(delay);
        bills = turn.bills;
        renderSeats(players, bills, turn.seat);
        await sleep(delay / 2);
      }

      const last = game.finale.at(-1);
      if (!skipped) {
        statusElement.textContent = 'Last bill! Roll a circle to take the pot';
        for (const roll of game.finale) {
          if (step > lastInvolved) {
            skipped = true;
            break;
          }
          const holders = Array(players).fill(0);
          holders[roll.seat] = 1;
          renderSeats(players, holders, roll.seat);
          if (roll.seat === 0) {
            showDice([]);
            statusElement.textContent = 'Last bill is yours! Roll a circle to take the pot';
            await waitForRoll();
          }
          showDice([roll.face]);
          sound.card();
          await sleep(stepDelay(step++));
        }
      }
      if (skipped) {
        statusElement.textContent = 'You are out, skipping to the end…';
        await sleep(600);
      }

      const holders = Array(players).fill(0);
      holders[game.winner] = 1;
      renderSeats(players, holders, -1, game.winner);
      statusElement.textContent = `${seatName(game.winner)} rolled ${FACES[last.face]} and takes the pot`;
      setBalance(game.balance);
      if (game.winner === 0) {
        sound.win(true);
        setMessage(`You won ${format(game.payout)} (net ${signed(game.payout - game.stake)})`, 'win');
      } else {
        sound.lose();
        setMessage(`${seatName(game.winner)} took the pot. You lost ${format(game.stake)}`, 'loss');
      }
    } catch (error) {
      setMessage(error.message, 'loss');
    } finally {
      playButton.disabled = false;
    }
  }

  playersInput.addEventListener('input', () => {
    updatePreview();
    renderSeats(Number(playersInput.value), Array(Number(playersInput.value)).fill(3));
  });
  betInput.addEventListener('input', updatePreview);
  playButton.addEventListener('click', play);
  document.querySelectorAll('[data-billsbet]').forEach(button => {
    button.addEventListener('click', () => {
      const current = Number(betInput.value) || 1;
      const next = {
        half: Math.floor(current / 2),
        double: current * 2,
        max: Math.floor(balance / 3)
      }[button.dataset.billsbet];
      betInput.value = Math.max(1, next);
      updatePreview();
    });
  });
  updatePreview();
  renderSeats(6, Array(6).fill(3));
})();

// Bets are whole numbers only: block decimal characters and strip any pasted ones.
['#plinkoBet', '#bjBet', '#billsBet'].forEach(selector => {
  const input = $(selector);
  input.addEventListener('keydown', event => {
    if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) {
      event.preventDefault();
    }
  });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (digits !== input.value) {
      input.value = digits;
      input.dispatchEvent(new window.Event('input'));
    }
  });
});

authReady.then(async auth => {
  if (!auth.user) {
    window.location.replace('/');
    return;
  }
  updateTotals();
  await Promise.all([loadMultipliers(), refreshBalance()]);
  window.resumeBlackjack();
});
