(() => {
  const key = 'ledger-theme';
  const root = document.documentElement;
  const apply = theme => {
    root.dataset.theme = theme === 'light' ? 'light' : 'dark';
    const button = document.querySelector('#themeToggle');
    if (button) {
      button.textContent = root.dataset.theme === 'dark' ? '☀ Light' : '☾ Dark';
      button.setAttribute('aria-label', `Switch to ${root.dataset.theme === 'dark' ? 'light' : 'dark'} theme`);
    }
  };
  try {
    apply(localStorage.getItem(key));
  } catch (error) {
    console.warn('Could not read the saved theme preference:', error);
    apply('dark');
  }
  window.ledgerTheme = {
    refresh: () => apply(root.dataset.theme),
    toggle: () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(theme);
      document.querySelectorAll('iframe').forEach(frame => {
        frame.contentWindow?.postMessage({ type: 'ledger-theme', theme }, location.origin);
      });
      try {
        localStorage.setItem(key, theme);
      } catch (error) {
        console.warn('Could not save the theme preference:', error);
      }
    }
  };
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
  window.addEventListener('message', event => {
    if (window.parent !== window && event.source === window.parent && event.origin === location.origin
      && event.data?.type === 'ledger-theme' && ['light', 'dark'].includes(event.data.theme)) {
      apply(event.data.theme);
    }
  });
})();
