window.pokerCards = {
  face(card) {
    const node = document.createElement('div');
    node.className = `bj-card${card.suit === '♥' || card.suit === '♦' ? ' red' : ''}`;
    node.setAttribute('aria-label', `${card.rank} ${card.suit}`);
    for (const className of ['corner top', 'pip', 'corner bottom']) {
      const part = document.createElement('span');
      part.className = className;
      part.textContent = className === 'pip' ? card.suit : `${card.rank}\n${card.suit}`;
      part.setAttribute('aria-hidden', 'true');
      node.append(part);
    }
    return node;
  },
  back() {
    const node = document.createElement('div');
    node.className = 'bj-card back';
    node.setAttribute('aria-label', 'Hidden card');
    return node;
  },
  empty() {
    const node = document.createElement('div');
    node.className = 'bj-card empty';
    node.setAttribute('aria-label', 'Community card not yet dealt');
    return node;
  },
};

window.pokerCards.dealer = (playCard, isVisible) => {
  const interval = 130;
  const duration = 360;
  let hand = null;
  let boardCount = 0;
  let times = new Map();
  let timers = [];
  let sequenceEnd = 0;

  function reset() {
    timers.forEach(timer => window.clearTimeout(timer));
    timers = [];
    times = new Map();
    sequenceEnd = 0;
    hand = null;
    boardCount = 0;
  }

  function update(handNumber, boardLength, seatIds, fresh = false) {
    const now = Date.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = hand === null;
    const newHand = !first && hand !== handNumber;
    if (newHand) {
      reset();
    }
    const deal = handNumber > 0 && (newHand || (first && fresh));
    const existingBoard = first && !fresh ? boardLength : boardCount;
    hand = handNumber;
    const keys = [];
    if (deal) {
      for (let card = 0; card < 2; card++) {
        for (const id of seatIds) keys.push(`hole:${id}:${card}`);
      }
    }
    for (let i = existingBoard; i < boardLength; i++) keys.push(`board:${i}`);
    boardCount = boardLength;
    if (!keys.length) return;
    if (reduced) {
      if (isVisible()) playCard();
      return;
    }
    const start = Math.max(now, sequenceEnd);
    let time = start;
    keys.forEach((key, index) => {
      if (index && (key === 'board:3' || key === 'board:4')) time += 220;
      times.set(key, time);
      timers.push(window.setTimeout(() => {
        if (isVisible()) playCard();
      }, Math.max(0, time - now)));
      time += interval;
    });
    sequenceEnd = time;
  }

  function decorate(node, key) {
    const time = times.get(key);
    if (time === undefined) return node;
    const delay = time - Date.now();
    if (delay <= -duration) return node;
    node.classList.add('poker-dealt');
    node.style.animationDelay = `${delay}ms`;
    return node;
  }

  return { update, decorate, reset };
};
