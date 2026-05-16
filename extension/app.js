/* ================================================================
   Tab Less — Dashboard App (Bento Edition)

   Reads tabs from chrome.tabs, groups by domain, renders a 6-color
   masonry of cards plus user-defined quick-link shortcuts.
   No server, no saved-for-later sidebar — everything fits the
   AI Studio prototype.
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   THEMES
   ---------------------------------------------------------------- */

const CARD_THEMES = [
  { bg: '#EEF2F7', text: '#1A56B8' }, // Blue
  { bg: '#EDF1EC', text: '#1F6F33' }, // Green
  { bg: '#F8F4EF', text: '#B07A2A' }, // Orange
  { bg: '#FBF1F0', text: '#C95D58' }, // Red
  { bg: '#F0EEF5', text: '#8B6BC4' }, // Purple
  { bg: '#EDF5F6', text: '#3E8E97' }, // Teal
];

const ACCENT_COLORS = CARD_THEMES.map(t => t.text);

const themeFor = (i) => CARD_THEMES[((i % CARD_THEMES.length) + CARD_THEMES.length) % CARD_THEMES.length];
const themeStyle = (t) => `--theme-bg: ${t.bg}; --theme-text: ${t.text};`;
const randomTheme = () => CARD_THEMES[Math.floor(Math.random() * CARD_THEMES.length)];

// One theme picked per page load — used for the dupes banner + default toast
const SESSION_THEME = randomTheme();


/* ----------------------------------------------------------------
   HTML / ATTRIBUTE ESCAPING
   ---------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access
   ---------------------------------------------------------------- */

let openTabs = [];

async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    openTabs = [];
  }
}

async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;
  const targetHostnames = [];
  const exactUrls = new Set();
  for (const u of urls) {
    if (u.startsWith('file://')) { exactUrls.add(u); }
    else {
      try { targetHostnames.push(new URL(u).hostname); } catch {}
    }
  }
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const url = tab.url || '';
      if (url.startsWith('file://') && exactUrls.has(url)) return true;
      try {
        const h = new URL(url).hostname;
        return h && targetHostnames.includes(h);
      } catch { return false; }
    })
    .map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }
  if (matches.length === 0) return;
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );
  if (tabOutTabs.length <= 1) return;
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   QUICK LINKS — chrome.storage.local
   ---------------------------------------------------------------- */

const DEFAULT_QUICK_LINKS = [
  { id: '1', title: 'Gmail',     url: 'https://mail.google.com' },
  { id: '2', title: 'GitHub',    url: 'https://github.com' },
  { id: '3', title: 'AI Studio', url: 'https://aistudio.google.com' },
  { id: '4', title: 'Notion',    url: 'https://notion.so' },
];

async function getQuickLinks() {
  try {
    const { quickLinks } = await chrome.storage.local.get('quickLinks');
    if (Array.isArray(quickLinks)) return quickLinks;
  } catch {}
  return DEFAULT_QUICK_LINKS;
}

async function saveQuickLinks(links) {
  try { await chrome.storage.local.set({ quickLinks: links }); }
  catch (err) { console.warn('[tab-out] saveQuickLinks failed:', err); }
}

async function addQuickLink(title, rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  const links = await getQuickLinks();
  links.push({ id: Date.now().toString(), title: title.trim(), url });
  await saveQuickLinks(links);
  return links;
}

async function removeQuickLink(id) {
  const links = await getQuickLinks();
  const next = links.filter(l => l.id !== id);
  await saveQuickLinks(next);
  return next;
}

async function renderQuickLinks() {
  const container = document.getElementById('quickLinks');
  if (!container) return;
  const links = await getQuickLinks();

  const chips = links.map((link, i) => {
    const theme   = themeFor(i);
    const initial = ((link.title || link.url || '?').trim().charAt(0) || '?').toUpperCase();
    let host = '';
    try { host = new URL(link.url).hostname; } catch {}
    const faviconUrl = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : '';
    return `
      <a class="quick-link" draggable="true" href="${escapeAttr(link.url)}" style="${themeStyle(theme)}" data-link-id="${escapeAttr(link.id)}">
        <span class="avatar">
          <span class="avatar-letter">${escapeHtml(initial)}</span>
          ${faviconUrl ? `<img class="avatar-img" src="${escapeAttr(faviconUrl)}" alt="" onerror="this.remove()" draggable="false">` : ''}
        </span>
        <span class="label">${escapeHtml(link.title)}</span>
        <button class="quick-link-remove" data-action="remove-quick-link" data-link-id="${escapeAttr(link.id)}" title="Remove shortcut">
          ${ICONS.close}
        </button>
      </a>
    `;
  }).join('');

  container.innerHTML = chips + `
    <button class="quick-link-add" data-action="open-shortcut-modal">
      ${ICONS.plus}
      <span>Shortcut</span>
    </button>
  `;
}


/* ----------------------------------------------------------------
   MODAL
   ---------------------------------------------------------------- */

function openShortcutModal() {
  const m = document.getElementById('shortcutModal');
  if (!m) return;
  m.style.display = 'flex';
  setTimeout(() => document.getElementById('shortcutTitle')?.focus(), 50);
}

function closeShortcutModal() {
  const m = document.getElementById('shortcutModal');
  if (!m) return;
  m.style.display = 'none';
  document.getElementById('shortcutForm')?.reset();
}


/* ----------------------------------------------------------------
   UI HELPERS — confetti, toast, empty state
   ---------------------------------------------------------------- */

function shootConfetti(x, y) {
  const particleCount = 17;
  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80;
    const gravity = 200;
    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200;

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      if (progress >= 1) { el.remove(); return; }
      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);
      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;
  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 280);
}

function showToast(message, color) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  document.getElementById('toastText').textContent = message;
  toast.style.setProperty('--theme-text', color || SESSION_THEME.text);
  toast.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}


/* ----------------------------------------------------------------
   GREETING + DATE
   ---------------------------------------------------------------- */

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getGreetingEmoji() {
  const hour = new Date().getHours();
  if (hour < 12) return '☀️';
  if (hour < 17) return '🌞';
  return '🌙';
}

function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}

let _lastGreeting = '';

function renderRainbowGreeting() {
  const el = document.getElementById('greeting');
  if (!el) return;
  const text = getGreeting();
  el.innerHTML = '';
  for (const ch of text) {
    if (ch === ' ') {
      el.appendChild(document.createTextNode(' '));
      continue;
    }
    const span = document.createElement('span');
    span.textContent = ch;
    span.style.color = ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)];
    el.appendChild(span);
  }
  // Emoji at the end, not colored — kept as one atomic unit so multi-codepoint
  // emojis like ☀️ (U+2600 U+FE0F) don't get split across spans.
  el.appendChild(document.createTextNode(' '));
  const emoji = document.createElement('span');
  emoji.className = 'greeting-emoji';
  emoji.textContent = getGreetingEmoji();
  el.appendChild(emoji);
  _lastGreeting = text;
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP
   ---------------------------------------------------------------- */

const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'aistudio.google.com':  'AI Studio',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];
  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }
  const clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');
  return clean.split('.').map(p => capitalize(p)).join(' ');
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  title = title.replace(/\s*[\-‐-―]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';
  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];
  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix    = title.slice(idx + sep.length).trim();
    const suffixLow = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }
  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }
  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }
  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }
  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1] && titleIsUrl) {
      return `r/${parts[subIdx + 1]} post`;
    }
  }
  return title || url;
}


/* ----------------------------------------------------------------
   ICONS
   ---------------------------------------------------------------- */

const ICONS = {
  close: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  plus:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE
   ---------------------------------------------------------------- */

let domainGroups = [];


/* ----------------------------------------------------------------
   FILTER: real web tabs only
   ---------------------------------------------------------------- */

function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}


/* ----------------------------------------------------------------
   TAB OUT DUPES BANNER — themed background
   ---------------------------------------------------------------- */

function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.cssText = themeStyle(SESSION_THEME);
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW ROWS ("+N more")
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts, groupDomain) {
  const rows = hiddenTabs.map(tab => renderTabRow(tab, urlCounts[tab.url] || 1, groupDomain)).join('');
  return `
    <div class="page-chips-overflow" style="display:none">${rows}</div>
    <div class="page-chip-overflow clickable" data-action="expand-chips">
      <span>+${hiddenTabs.length} more</span>
    </div>
  `;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

function renderTabRow(tab, count, groupDomain) {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), groupDomain);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) {
      label = `${parsed.port} ${label}`;
    }
  } catch {}

  const safeUrl   = escapeAttr(tab.url || '');
  const safeLabel = escapeAttr(label);
  const dupeTag   = count > 1 ? `<span class="chip-dupe-badge">${count}x</span>` : '';

  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const faviconUrl = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=32` : '';

  return `
    <div class="page-chip clickable" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeLabel}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.remove()">` : ''}
      <span class="chip-text-wrap">
        <span class="chip-text">${escapeHtml(label)}</span>
        ${dupeTag}
      </span>
      <span class="chip-actions">
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close tab">
          ${ICONS.close}
        </button>
      </span>
    </div>
  `;
}

function renderDomainCard(group, index) {
  const theme     = themeFor(index);
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  const urlCounts = {};
  for (const t of tabs) urlCounts[t.url] = (urlCounts[t.url] || 0) + 1;

  // Deduplicate for display (show one row per URL with Nx badge)
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }
  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const title = isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain));

  return `
    <div class="mission-card" data-domain-id="${stableId}" data-theme-color="${theme.text}" style="${themeStyle(theme)}">
      <div class="mission-top">
        <span class="mission-name" title="${escapeAttr(title)}">${escapeHtml(title)}</span>
        <span class="open-tabs-badge">${tabCount} ${tabCount === 1 ? 'tab' : 'tabs'}</span>
      </div>
      <div class="mission-pages">
        ${visibleTabs.map(tab => renderTabRow(tab, urlCounts[tab.url], group.domain)).join('')}
        ${extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts, group.domain) : ''}
      </div>
      <div class="mission-footer">
        <button class="mission-footer-btn" data-action="close-domain-tabs" data-domain-id="${stableId}">
          ${ICONS.close}
          Close all ${tabCount} tab${tabCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  `;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

async function renderDashboard() {
  // --- Header ---
  renderRainbowGreeting();
  const dateEl = document.getElementById('dateDisplay');
  if (dateEl) dateEl.textContent = getDateDisplay();

  // --- Quick links ---
  await renderQuickLinks();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Landing pages config ---
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com',  test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',            pathExact: ['/home'] },
    { hostname: 'www.linkedin.com', pathExact: ['/'] },
    { hostname: 'github.com',       pathExact: ['/'] },
    { hostname: 'www.youtube.com',  pathExact: ['/'] },
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        const hostMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith ? parsed.hostname.endsWith(p.hostnameEndsWith) : false;
        if (!hostMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith ? parsed.hostname.endsWith(r.hostnameEndsWith) : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) { landingTabs.push(tab); continue; }
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }
      let hostname;
      if (tab.url && tab.url.startsWith('file://')) hostname = 'local-files';
      else                                          hostname = new URL(tab.url).hostname;
      if (!hostname) continue;
      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {}
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes  = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(d) {
    if (landingHostnames.has(d)) return true;
    return landingSuffixes.some(s => d.endsWith(s));
  }

  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aL = a.domain === '__landing-pages__';
    const bL = b.domain === '__landing-pages__';
    if (aL !== bL) return aL ? -1 : 1;
    const aP = isLandingDomain(a.domain);
    const bP = isLandingDomain(b.domain);
    if (aP !== bP) return aP ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  // --- Render cards ---
  const section    = document.getElementById('openTabsSection');
  const missionsEl = document.getElementById('openTabsMissions');
  const countEl    = document.getElementById('openTabsSectionCount');

  if (domainGroups.length > 0 && section) {
    countEl.innerHTML = `${domainGroups.length} domain${domainGroups.length === 1 ? '' : 's'}` +
      ` <button class="inline-btn" data-action="close-all-open-tabs">${ICONS.close} Close all ${realTabs.length}</button>`;
    missionsEl.innerHTML = domainGroups.map((g, i) => renderDomainCard(g, i)).join('');
    section.style.display = 'block';
  } else if (section) {
    section.style.display = 'block';
    countEl.textContent = '0 domains';
    missionsEl.innerHTML = '';
    checkAndShowEmptyState();
  }

  // --- Tab Less duplicate banner ---
  checkTabOutDupes();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — single delegate on document
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // Modal: open
  if (action === 'open-shortcut-modal') {
    e.preventDefault();
    openShortcutModal();
    return;
  }

  // Modal: close (backdrop or cancel button)
  if (action === 'close-shortcut-modal') {
    // Only close if the click was on the backdrop itself (not children)
    if (actionEl.id === 'shortcutModal' && e.target !== actionEl) return;
    closeShortcutModal();
    return;
  }

  // Remove a quick link
  if (action === 'remove-quick-link') {
    e.preventDefault();
    e.stopPropagation();
    const id = actionEl.dataset.linkId;
    if (id) {
      await removeQuickLink(id);
      await renderQuickLinks();
    }
    return;
  }

  // Close all duplicate Tab Less new-tab pages
  if (action === 'close-tabout-dupes') {
    const banner = document.getElementById('tabOutDupeBanner');
    const themeColor = SESSION_THEME.text;
    const btnRect = actionEl.getBoundingClientRect();
    shootConfetti(btnRect.left + btnRect.width / 2, btnRect.top + btnRect.height / 2);
    await closeTabOutDupes();
    if (banner) {
      banner.style.transition = 'opacity 0.3s ease';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 300);
    }
    showToast('Extras closed', themeColor);
    return;
  }

  const card = actionEl.closest('.mission-card');
  const cardTheme = card?.dataset.themeColor || SESSION_THEME.text;

  // Expand "+N more" row
  if (action === 'expand-chips') {
    const overflow = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflow) {
      overflow.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // Focus an existing tab
  if (action === 'focus-tab') {
    const url = actionEl.dataset.tabUrl;
    if (url) await focusTab(url);
    return;
  }

  // Close a single tab
  if (action === 'close-single-tab') {
    e.stopPropagation();
    const url = actionEl.dataset.tabUrl;
    if (!url) return;

    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === url);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.92)';
      setTimeout(() => {
        chip.remove();
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    showToast('Tab closed', cardTheme);
    return;
  }

  // Close all tabs for a domain
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(g =>
      'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId
    );
    if (!group) return;

    const urls     = group.tabs.map(t => t.url);
    const useExact = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) await closeTabsExact(urls);
    else          await closeTabsByUrls(urls);

    if (card) {
      animateCardOut(card);
    }
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    showToast('Tab closed', cardTheme);
    return;
  }

  // Close all open tabs
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      const r = c.getBoundingClientRect();
      shootConfetti(r.left + r.width / 2, r.top + r.height / 2);
      animateCardOut(c);
    });
    showToast('All tabs closed', SESSION_THEME.text);
    return;
  }
});


/* ----------------------------------------------------------------
   SHORTCUT FORM SUBMIT
   ---------------------------------------------------------------- */

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'shortcutForm') return;
  e.preventDefault();
  const title = document.getElementById('shortcutTitle').value.trim();
  const url   = document.getElementById('shortcutUrl').value.trim();
  if (!title || !url) return;
  await addQuickLink(title, url);
  closeShortcutModal();
  await renderQuickLinks();
});


/* ----------------------------------------------------------------
   ESC TO CLOSE MODAL
   ---------------------------------------------------------------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('shortcutModal');
    if (m && m.style.display !== 'none') closeShortcutModal();
  }
});


/* ----------------------------------------------------------------
   QUICK LINKS — drag-and-drop reordering
   ---------------------------------------------------------------- */

(function wireQuickLinkDnD() {
  const container = document.getElementById('quickLinks');
  if (!container) return;

  let dragSrcId = null;

  function clearIndicators() {
    container.querySelectorAll('.drag-before, .drag-after').forEach(el => {
      el.classList.remove('drag-before', 'drag-after');
    });
  }

  container.addEventListener('dragstart', (e) => {
    const link = e.target.closest('.quick-link');
    if (!link) return;
    dragSrcId = link.dataset.linkId;
    link.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require data to start a drag at all
    try { e.dataTransfer.setData('text/plain', dragSrcId); } catch {}
  });

  container.addEventListener('dragend', () => {
    container.querySelectorAll('.quick-link').forEach(el => el.classList.remove('dragging'));
    clearIndicators();
    dragSrcId = null;
  });

  container.addEventListener('dragover', (e) => {
    if (!dragSrcId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    clearIndicators();
    const target = e.target.closest('.quick-link');
    if (target && target.dataset.linkId !== dragSrcId) {
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      target.classList.add(before ? 'drag-before' : 'drag-after');
    }
  });

  container.addEventListener('drop', async (e) => {
    if (!dragSrcId) return;
    e.preventDefault();
    const srcId = dragSrcId;
    const target = e.target.closest('.quick-link');

    const links = await getQuickLinks();
    const srcIdx = links.findIndex(l => l.id === srcId);
    if (srcIdx === -1) return;
    const [src] = links.splice(srcIdx, 1);

    if (!target || target.dataset.linkId === srcId) {
      // Dropped on the add button or empty space → move to end
      links.push(src);
    } else {
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      let tIdx = links.findIndex(l => l.id === target.dataset.linkId);
      if (tIdx === -1) {
        links.push(src);
      } else {
        if (!before) tIdx++;
        links.splice(tIdx, 0, src);
      }
    }

    await saveQuickLinks(links);
    await renderQuickLinks();
  });
})();


/* ----------------------------------------------------------------
   CLOCK SYNC — refresh greeting + date as the hour rolls over
   ---------------------------------------------------------------- */

function syncClock() {
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (!greetingEl || !dateEl) return;

  // Only re-render the rainbow when the greeting text actually changes,
  // so the per-letter colors don't flicker every tick.
  if (_lastGreeting !== getGreeting()) {
    renderRainbowGreeting();
  }
  const dateText = getDateDisplay();
  if (dateEl.textContent !== dateText) {
    dateEl.textContent = dateText;
  }
}

setInterval(syncClock, 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) syncClock();
});


/* ----------------------------------------------------------------
   BOOTSTRAP
   ---------------------------------------------------------------- */

renderDashboard();
