const statElements = {
  guildCount: document.querySelector('#serverCount'),
  uniqueUsers: document.querySelector('#userCount'),
  totalBalance: document.querySelector('#balanceTotal'),
  totalExperience: document.querySelector('#experienceTotal')
};
const inviteBot = document.querySelector('#inviteBot');
const installUser = document.querySelector('#installUser');
const inviteStatus = document.querySelector('#inviteStatus');
const homeStatus = document.querySelector('#homeStatus');
const topPlayers = document.querySelector('#topPlayers');
const integerFormat = new Intl.NumberFormat();

function formatInteger(value) {
  return integerFormat.format(BigInt(value));
}

function setCount(element, value, suffix = '', prefix = '') {
  element.textContent = value === null
    ? 'Unavailable'
    : `${prefix}${formatInteger(value)}${suffix}`;
}

async function loadHomeStats() {
  try {
    const response = await fetch('/api/home', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const stats = await response.json();

    setCount(statElements.guildCount, stats.guildCount);
    setCount(statElements.uniqueUsers, stats.uniqueUsers);
    setCount(statElements.totalBalance, stats.totalBalance, '', '$');
    setCount(statElements.totalExperience, stats.totalExperience, ' XP');

    if (stats.inviteUrl) {
      inviteBot.href = stats.inviteUrl;
    } else {
      inviteBot.classList.add('hidden');
      inviteStatus.textContent = 'The bot invite link is not configured.';
    }
    if (stats.userInstallUrl) {
      installUser.href = stats.userInstallUrl;
    } else {
      installUser.classList.add('hidden');
    }

    topPlayers.replaceChildren();
    if (stats.topPlayers.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'top-player-empty';
      empty.textContent = 'No players have joined the ledger yet.';
      topPlayers.appendChild(empty);
    } else {
      stats.topPlayers.forEach((player, index) => {
        const row = document.createElement('li');
        row.className = 'top-player';
        const rank = document.createElement('span');
        rank.className = 'top-player-rank';
        rank.textContent = `#${index + 1}`;
        const name = document.createElement('a');
        name.href = `/leaderboard?id=${encodeURIComponent(player.id)}`;
        name.textContent = player.name;
        const level = document.createElement('span');
        level.className = 'top-player-level';
        level.textContent = `Prestige ${formatInteger(player.prestige)} · Level ${formatInteger(player.level)}`;
        const balance = document.createElement('strong');
        balance.className = 'top-player-balance';
        balance.textContent = `$${formatInteger(player.balance)}`;
        row.append(rank, name, level, balance);
        topPlayers.appendChild(row);
      });
    }

    if (stats.discordStatsUpdatedAt) {
      const checkedAt = new Date(stats.discordStatsUpdatedAt);
      homeStatus.textContent = `Server membership last checked ${checkedAt.toLocaleString()}.`;
    } else {
      homeStatus.textContent = 'Live server membership stats are temporarily unavailable.';
    }
  } catch (error) {
    console.error('Could not load homepage statistics:', error);
    inviteBot.classList.add('hidden');
    installUser.classList.add('hidden');
    inviteStatus.textContent = 'The bot invite link is temporarily unavailable.';
    Object.values(statElements).forEach(element => {
      element.textContent = 'Unavailable';
    });
    homeStatus.textContent = `Could not load community statistics. ${error.message}`;
  }
}

void loadHomeStats();
