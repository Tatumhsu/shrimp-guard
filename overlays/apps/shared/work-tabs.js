// Shared, hash-addressable tabs. Each app owns its DOM and initializes once.
export function mountTabs(loaders) {
  const ids = Object.keys(loaders);
  const links = ids.map(id => document.getElementById(`tab-${id}`));
  const panels = ids.map(id => document.getElementById(`${id}-panel`));
  const pending = new Map(), apps = new Map(), scroll = new Map();
  let selected;

  async function load(id, panel) {
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      panel.setAttribute('aria-busy', 'true');
      let message = panel.querySelector('.work-message');
      if (!message) {
        message = document.createElement('p');
        message.className = 'work-message';
        message.setAttribute('role', 'status');
        panel.prepend(message);
      }
      message.textContent = '載入中…';
      try {
        const app = await loaders[id](panel);
        apps.set(id, app);
        app?.setActive?.(selected === id && !document.hidden);
        message.remove();
      } catch (error) {
        pending.delete(id);
        panel.dataset.ready = 'error';
        message.textContent = '暫時無法載入，請再試一次。 ';
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = '重新載入';
        retry.addEventListener('click', () => load(id, panel), { once: true });
        message.append(retry);
      } finally {
        panel.setAttribute('aria-busy', 'false');
      }
    })();
    pending.set(id, task);
    return task;
  }

  function select() {
    const hash = location.hash.slice(1);
    const id = ids.includes(hash) ? hash : ids[0];
    if (selected === id) return;
    if (selected) {
      scroll.set(selected, window.scrollY);
      apps.get(selected)?.setActive?.(false);
    }
    selected = id;
    document.body.dataset.workTab = id;
    ids.forEach((key, i) => {
      const active = key === id;
      panels[i].hidden = !active;
      links[i].setAttribute('aria-selected', String(active));
      links[i].tabIndex = active ? 0 : -1;
    });
    window.scrollTo(0, scroll.get(id) || 0);
    apps.get(id)?.setActive?.(!document.hidden);
    load(id, panels[ids.indexOf(id)]);
  }

  links.forEach((link, i) => {
    link.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      select();
    });
    link.addEventListener('keydown', event => {
      const next = { ArrowRight: (i + 1) % ids.length, ArrowLeft: (i + ids.length - 1) % ids.length,
        Home: 0, End: ids.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); links[next].focus(); links[next].click();
    });
  });
  window.addEventListener('hashchange', select);
  window.addEventListener('popstate', select);
  document.addEventListener('visibilitychange', () => apps.get(selected)?.setActive?.(!document.hidden));
  // Match the real bar height, including safe-area insets and enlarged text.
  const bar = document.querySelector('.work-tabs');
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--work-tabs-height', `${bar.offsetHeight}px`);
    window.dispatchEvent(new Event('resize'));
  }).observe(bar);
  select();
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('Script unavailable')); };
    document.head.append(script);
  });
}
