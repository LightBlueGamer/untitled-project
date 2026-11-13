const debugStatus = document.querySelector('#debugStatus');
const debugSettings = document.querySelector('#debugSettings');
const debugLogs = document.querySelector('#debugLogs');
const emptyDebugLogs = document.querySelector('#emptyDebugLogs');
const topicLabels = { chance: 'Companion appearance chance', rewards: 'Message rewards', gambling: 'Casino outcomes', lootboxes: 'Lootbox chances and rewards' };
let debugBusy = false;

async function refreshDiagnostics() {
  if (debugBusy) return;
  debugBusy = true;
  try {
    const response = await fetch('/api/developer', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    debugSettings.replaceChildren();
    for (const [topic, enabled] of Object.entries(data.settings)) {
      const row = document.createElement('div');
      row.className = 'developer-setting';
      const label = document.createElement('span');
      label.textContent = topicLabels[topic] || topic;
      const button = document.createElement('button');
      button.className = 'btn secondary-btn';
      button.type = 'button';
      button.textContent = enabled ? 'Enabled' : 'Disabled';
      button.setAttribute('aria-pressed', String(enabled));
      button.addEventListener('click', () => updateDebugSetting(topic, !enabled));
      row.append(label, button);
      debugSettings.append(row);
    }
    debugLogs.replaceChildren();
    for (const entry of data.logs) {
      const item = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${topicLabels[entry.topic] || entry.topic}`;
      const context = document.createElement('div');
      context.className = 'developer-log-context';
      context.textContent = [
        entry.username ? `User: ${entry.username}${entry.userId ? ` (${entry.userId})` : ''}` : entry.userId ? `User ID: ${entry.userId}` : null,
        entry.guild ? `Server: ${entry.guild}` : null,
        entry.channel ? `Channel: #${entry.channel}` : null,
      ].filter(Boolean).join(' · ');
      const message = document.createElement('div');
      message.textContent = entry.message;
      item.append(heading, context, message);
      debugLogs.append(item);
    }
    emptyDebugLogs.classList.toggle('hidden', data.logs.length > 0);
    debugStatus.textContent = 'Diagnostics are up to date.';
  } catch (error) {
    console.error('Could not load diagnostics:', error);
    debugStatus.textContent = 'Could not load diagnostics. Please try again.';
  } finally {
    debugBusy = false;
  }
}

async function updateDebugSetting(topic, enabled) {
  if (debugBusy) return;
  debugBusy = true;
  try {
    const response = await fetch(`/api/developer/settings/${encodeURIComponent(topic)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
  } catch (error) {
    console.error('Could not update diagnostics:', error);
    debugStatus.textContent = 'Could not update the setting. Please try again.';
    debugBusy = false;
    return;
  }
  debugBusy = false;
  await refreshDiagnostics();
}

document.querySelector('#refreshDebug').addEventListener('click', refreshDiagnostics);
refreshDiagnostics();
window.setInterval(refreshDiagnostics, 5000);
