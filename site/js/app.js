// Game Hub UI. Renders games.json as a server-browser style list with live stats (js/stats.js).
// No framework: rows are keyed DOM nodes that are updated in place and re-ordered, so focus survives live updates.
import { connect } from '/js/stats.js';

const $ = (s, r = document) => r.querySelector(s);
const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (typeof n === 'number' ? nf.format(n) : '—');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: session only */ } },
};

const state = {
  games: [],
  backend: undefined,   // undefined = still connecting, null = stats unavailable
  stats: null,          // {slug: {plays, likes, dislikes}} once live
  online: null,         // {slug: count} once live
  votes: store.get('hub.votes', {}), // this device's votes, mirrored for an instant first paint
  pending: {},          // optimistic vote deltas not yet handed to Firebase
  favs: new Set(store.get('hub.favs', [])),
  recent: store.get('hub.recent', {}),
  tab: 'all', sort: store.get('hub.sort', 'online'), q: '', tag: null,
};

const list = $('#list');
const rows = new Map();

// ---------------------------------------------------------------- helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}
const svg = (d, extra = '') => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`; return t.content.firstChild; };
const ICON_SHARE = '<path d="M12 15V3m0 0L8 7m4-4 4 4M6 11H5v10h14V11h-1"/>';
const ICON_PLAY = '<path d="M7 4.5v15l12.5-7.5z"/>';
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const live = () => state.backend && state.stats;
function counts(slug) {
  if (!live()) return null;
  const s = state.stats[slug] || {};
  const p = state.pending[slug] || { likes: 0, dislikes: 0 };
  return { plays: s.plays || 0, likes: Math.max(0, (s.likes || 0) + p.likes), dislikes: Math.max(0, (s.dislikes || 0) + p.dislikes) };
}
const onlineOf = (slug) => (state.online ? state.online[slug] || 0 : null);
function playHref(g) {
  try {
    const u = new URL(g.url, location.href);
    return u.origin === location.origin ? u.pathname + u.search : `/play/?g=${encodeURIComponent(g.slug)}`;
  } catch { return `/play/?g=${encodeURIComponent(g.slug)}`; }
}
function wilson(up, down) { // lower bound of the 95% interval: fair "top rated" with few votes
  const n = up + down; if (!n) return 0;
  const z = 1.96, p = up / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}
function rememberPlay(slug) { state.recent[slug] = Date.now(); store.set('hub.recent', state.recent); }

// ---------------------------------------------------------------- rows
function makeParts(g) {
  const main = h('button', { class: 'row-main', type: 'button', 'data-act': 'open', 'aria-haspopup': 'dialog' },
    h('span', { class: 'rank' }),
    h('img', { class: 'icon', src: g.icon, width: 64, height: 64, alt: '', loading: 'lazy', decoding: 'async' }),
    h('span', { class: 'info' },
      h('span', { class: 'name' }, h('span', { class: 'name-text', text: g.name })),
      h('span', { class: 'tagline', text: g.tagline }),
      h('span', { class: 'row-tags' }, ...g.tags.map((t) => h('span', { class: 'tag', text: t }))),
    ),
  );
  const bars = h('span', { class: 'bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const stats = h('div', { class: 'stats' },
    h('span', { class: 'online' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('b', { class: 'n-online' }), h('span', { text: ' online' }), bars),
    h('span', { class: 'plays' }, h('b', { class: 'n-plays' }), h('span', { text: ' plays' })),
  );
  const play = () => { const a = h('a', { class: 'play', href: playHref(g), 'data-act': 'play' }, svg(ICON_PLAY), h('span', { text: 'Play' })); a.setAttribute('aria-label', `Play ${g.name}`); return a; };
  const actions = h('div', { class: 'actions' },
    h('button', { class: 'act like', type: 'button', 'data-act': 'like', 'aria-pressed': 'false' }, h('span', { class: 'emo', 'aria-hidden': 'true', text: '👍' }), h('span', { class: 'n n-likes' })),
    h('button', { class: 'act dislike', type: 'button', 'data-act': 'dislike', 'aria-pressed': 'false' }, h('span', { class: 'emo', 'aria-hidden': 'true', text: '👎' }), h('span', { class: 'n n-dislikes' })),
    h('button', { class: 'act fav', type: 'button', 'data-act': 'fav', 'aria-pressed': 'false' }, h('span', { class: 'emo', 'aria-hidden': 'true', text: '★' })),
    h('button', { class: 'act share', type: 'button', 'data-act': 'share', 'aria-label': `Share ${g.name}` }, svg(ICON_SHARE)),
    play(),
  );
  return { main, stats, actions, play };
}
function makeRow(g) {
  const li = h('li', { class: 'row', 'data-slug': g.slug });
  li.style.setProperty('--c', g.color || 'var(--accent)');
  const p = makeParts(g);
  li.append(p.main, p.stats, p.actions, p.play());
  return li;
}

function bucket(n) { return n == null || n <= 0 ? 0 : n < 3 ? 1 : n < 10 ? 2 : n < 25 ? 3 : 4; }

function updateRow(li, g, rank) {
  const rankEl = li.querySelector('.rank');
  if (rankEl) rankEl.textContent = `#${rank}`;
  const c = counts(g.slug);
  const on = onlineOf(g.slug);
  const fav = state.favs.has(g.slug);
  const vote = state.votes[g.slug] || 0;
  const onEl = li.querySelector('.online');
  onEl.classList.toggle('off', on == null);
  onEl.classList.toggle('none', on === 0);
  onEl.classList.toggle('hot', on > 0);
  li.querySelector('.n-online').textContent = fmt(on);
  li.querySelectorAll('.bars i').forEach((b, i) => b.classList.toggle('on', i < bucket(on)));
  li.querySelector('.bars').setAttribute('title', on == null ? 'Live stats unavailable' : `${on} playing now`);
  li.querySelector('.n-plays').textContent = fmt(c && c.plays);
  const like = li.querySelector('.like'), dislike = li.querySelector('.dislike');
  li.querySelector('.n-likes').textContent = fmt(c && c.likes);
  li.querySelector('.n-dislikes').textContent = fmt(c && c.dislikes);
  like.setAttribute('aria-pressed', String(vote === 1));
  dislike.setAttribute('aria-pressed', String(vote === -1));
  const canVote = !!state.backend;
  like.disabled = !canVote; dislike.disabled = !canVote;
  like.setAttribute('aria-label', `Like ${g.name}${c ? `, ${c.likes} likes` : ''}${canVote ? '' : ' (live stats unavailable)'}`);
  dislike.setAttribute('aria-label', `Dislike ${g.name}${c ? `, ${c.dislikes} dislikes` : ''}${canVote ? '' : ' (live stats unavailable)'}`);
  const favBtn = li.querySelector('.fav');
  favBtn.setAttribute('aria-pressed', String(fav));
  favBtn.setAttribute('aria-label', fav ? `Remove ${g.name} from favourites` : `Add ${g.name} to favourites`);
  const nameEl = li.querySelector('.name');
  if (nameEl) {
    const mark = nameEl.querySelector('.fav-mark');
    if (fav && !mark) nameEl.append(h('span', { class: 'fav-mark', 'aria-label': 'Favourite', text: '★' }));
    if (!fav && mark) mark.remove();
  }
  li.querySelector('.row-main')?.setAttribute('aria-label', `${g.name}: ${g.tagline}. Show details`);
}

// ---------------------------------------------------------------- list
function visibleGames() {
  const q = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let gs = state.games.filter((g) => {
    if (state.tab === 'favs' && !state.favs.has(g.slug)) return false;
    if (state.tab === 'recent' && !state.recent[g.slug]) return false;
    if (state.tag && !g.tags.includes(state.tag)) return false;
    if (q.length) {
      const hay = `${g.name} ${g.tagline} ${g.description} ${g.tags.join(' ')}`.toLowerCase();
      if (!q.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const key = {
    online: (g) => [onlineOf(g.slug) || 0, (counts(g.slug) || {}).plays || 0],
    plays: (g) => [(counts(g.slug) || {}).plays || 0, onlineOf(g.slug) || 0],
    rating: (g) => { const c = counts(g.slug) || { likes: 0, dislikes: 0 }; return [wilson(c.likes, c.dislikes), c.likes]; },
    newest: (g) => [Date.parse(g.addedAt) || 0, 0],
  }[state.sort] || (() => [0, 0]);
  const cmp = (a, b) => {
    const ka = key(a), kb = key(b);
    return kb[0] - ka[0] || kb[1] - ka[1] || (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || a.name.localeCompare(b.name);
  };
  if (state.tab === 'recent') return gs.sort((a, b) => state.recent[b.slug] - state.recent[a.slug]);
  gs.sort(cmp);
  if (state.tab === 'all') gs = [...gs.filter((g) => state.favs.has(g.slug)), ...gs.filter((g) => !state.favs.has(g.slug))];
  return gs;
}

function render() {
  if (!state.games.length) return;
  list.setAttribute('aria-busy', 'false');
  const gs = visibleGames();
  list.querySelectorAll('.skeleton, .empty').forEach((e) => e.remove());
  const keep = new Set(gs.map((g) => g.slug));
  for (const [slug, li] of rows) if (!keep.has(slug)) li.remove();
  gs.forEach((g, i) => {
    let li = rows.get(g.slug);
    if (!li) { li = makeRow(g); rows.set(g.slug, li); }
    updateRow(li, g, i + 1);
    if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
  });
  if (!gs.length) {
    const msg = state.tab === 'favs' && !state.favs.size ? ['No favourites yet', 'Tap ★ on a game to keep it here.']
      : state.tab === 'recent' && !Object.keys(state.recent).length ? ['Nothing played yet', 'Games you open show up here.']
        : ['No games match', 'Try another search or tag.'];
    list.append(h('li', { class: 'empty' }, h('b', { text: msg[0] }), h('span', { text: msg[1] })));
  }
  const total = state.online ? state.games.reduce((n, g) => n + (state.online[g.slug] || 0), 0) : null;
  $('#total-online').textContent = fmt(total);
  $('.live').classList.toggle('off', total == null);
  $('#status').textContent = state.tab === 'all' && !state.q && !state.tag ? '' : `${gs.length} of ${state.games.length} games`;
  if (openSlug) fillDetailStats(openSlug);
}

function renderTags() {
  const freq = new Map();
  for (const g of state.games) for (const t of g.tags) freq.set(t, (freq.get(t) || 0) + 1);
  const tags = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b));
  const box = $('#tags');
  box.replaceChildren(h('button', { class: 'chip', type: 'button', 'data-tag': '', 'aria-pressed': String(!state.tag), text: 'All tags' }),
    ...tags.map((t) => h('button', { class: 'chip', type: 'button', 'data-tag': t, 'aria-pressed': String(state.tag === t), text: t })));
}

// ---------------------------------------------------------------- actions
async function vote(slug, dir) {
  const g = state.games.find((x) => x.slug === slug);
  if (!state.backend) { toast('Live stats are not available right now'); return; }
  const prev = state.votes[slug] || 0;
  const next = prev === dir ? 0 : dir;
  const delta = { likes: (next === 1) - (prev === 1), dislikes: (next === -1) - (prev === -1) };
  state.votes[slug] = next; store.set('hub.votes', state.votes);
  const p = state.pending[slug] || { likes: 0, dislikes: 0 };
  state.pending[slug] = { likes: p.likes + delta.likes, dislikes: p.dislikes + delta.dislikes };
  render();
  let settled = false;
  const settle = () => { // idempotent: runs once, when Firebase has the write (or when it never got it)
    if (settled) return; settled = true;
    const q = state.pending[slug]; if (q) { q.likes -= delta.likes; q.dislikes -= delta.dislikes; }
  };
  try {
    await state.backend.vote(slug, next, settle);
    render();
  } catch {
    settle(); // not applied: drop the optimistic delta (Firebase reverts its own local copy)
    state.votes[slug] = prev; store.set('hub.votes', state.votes);
    render();
    toast(`Couldn't save your vote for ${g ? g.name : slug}`);
  }
}

function toggleFav(slug) {
  if (state.favs.has(slug)) state.favs.delete(slug); else state.favs.add(slug);
  store.set('hub.favs', [...state.favs]);
  const g = state.games.find((x) => x.slug === slug);
  toast(state.favs.has(slug) ? `★ ${g.name} added to favourites` : `${g.name} removed from favourites`);
  render();
}

async function share(slug) {
  const g = state.games.find((x) => x.slug === slug);
  const url = `${location.origin}/g/${slug}/`;
  if (navigator.share) {
    try { await navigator.share({ title: g.name, text: g.tagline, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
}

// ---------------------------------------------------------------- detail view
const dlg = $('#detail');
let openSlug = null;
function fillDetailStats(slug) {
  const g = state.games.find((x) => x.slug === slug);
  const box = $('#d-actions');
  if (box.dataset.slug !== slug || !box.firstChild) { // same parts, handlers and live updates as the list row
    const p = makeParts(g);
    box.replaceChildren(...p.actions.children, p.stats);
    box.dataset.slug = slug;
  }
  updateRow(box, g, null);
}
function openDetail(slug, push = true) {
  const g = state.games.find((x) => x.slug === slug);
  if (!g) return;
  openSlug = slug;
  const inner = dlg.querySelector('.detail-inner');
  inner.style.setProperty('--c', g.color || 'var(--accent)');
  $('#d-banner').src = g.banner; $('#d-banner').alt = `${g.name} gameplay`;
  $('#d-icon').src = g.icon;
  $('#d-name').textContent = g.name;
  $('#d-tagline').textContent = g.tagline;
  $('#d-long').textContent = g.longDescription;
  $('#d-controls').replaceChildren(...(g.controls || []).map((c) => {
    const i = c.indexOf(':');
    return i > 0 ? h('li', {}, h('b', { text: c.slice(0, i + 1) }), document.createTextNode(c.slice(i + 1))) : h('li', { text: c });
  }));
  $('#d-platforms').textContent = g.platforms.map((p) => (p === 'desktop' ? 'Desktop' : p === 'mobile' ? 'Mobile' : p)).join(' · ');
  $('#d-updated').textContent = g.updatedAt ? new Date(g.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  $('#d-repo').href = g.repo;
  fillDetailStats(slug);
  if (!dlg.open) dlg.showModal();
  if (push) history.replaceState(null, '', `/?g=${encodeURIComponent(slug)}`);
  $('#d-close').focus();
}
function closeDetail() {
  if (dlg.open) dlg.close();
}
dlg.addEventListener('close', () => {
  const slug = openSlug; openSlug = null;
  if (new URLSearchParams(location.search).has('g')) history.replaceState(null, '', '/');
  const back = rows.get(slug)?.querySelector('.row-main');
  if (back) back.focus();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDetail(); });
$('#d-close').addEventListener('click', closeDetail);

// ---------------------------------------------------------------- events
function onAction(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const slug = el.closest('[data-slug]')?.dataset.slug;
  if (!slug) return;
  const act = el.dataset.act;
  if (act === 'play') { rememberPlay(slug); return; } // plain same-origin link: opens inside the installed app
  e.preventDefault();
  if (act === 'open') openDetail(slug);
  else if (act === 'like') vote(slug, 1);
  else if (act === 'dislike') vote(slug, -1);
  else if (act === 'fav') toggleFav(slug);
  else if (act === 'share') share(slug);
}
list.addEventListener('click', onAction);
$('#d-actions').addEventListener('click', onAction);

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(btn, focus) {
  for (const t of tabs) { const on = t === btn; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
  list.setAttribute('aria-labelledby', btn.id);
  state.tab = btn.dataset.tab;
  if (focus) btn.focus();
  render();
}
tabs.forEach((t) => t.addEventListener('click', () => selectTab(t)));
$('.tabs').addEventListener('keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
  if (j >= 0) { e.preventDefault(); selectTab(tabs[j], true); }
});
$('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });
const sortSel = $('#sort');
sortSel.value = ['online', 'plays', 'rating', 'newest'].includes(state.sort) ? state.sort : 'online';
state.sort = sortSel.value;
sortSel.addEventListener('change', () => { state.sort = sortSel.value; store.set('hub.sort', state.sort); render(); });
$('#tags').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  state.tag = b.dataset.tag && state.tag !== b.dataset.tag ? b.dataset.tag : null;
  document.querySelectorAll('#tags .chip').forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.tag || null) === state.tag)));
  render();
});

// theme
function setThemeUi() {
  const t = document.documentElement.dataset.theme;
  $('#theme').setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', t === 'dark' ? '#0B0D12' : '#F3F5F9'));
}
$('#theme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('hub.theme', t); } catch { /* ignore */ }
  setThemeUi();
});
setThemeUi();

// install: Chrome/Android prompt, iOS hint; both hidden once installed
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let deferredPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (!standalone()) $('#install').hidden = false; });
$('#install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch { /* ignore */ }
  deferredPrompt = null; $('#install').hidden = true;
});
addEventListener('appinstalled', () => { $('#install').hidden = true; $('#ios-hint').hidden = true; });
const ua = navigator.userAgent;
const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (ios && !standalone() && !store.get('hub.iosHintDismissed', false)) $('#ios-hint').hidden = false;
$('#ios-hint-close').addEventListener('click', () => { $('#ios-hint').hidden = true; store.set('hub.iosHintDismissed', true); });

// ---------------------------------------------------------------- boot
async function loadGames() {
  try {
    const res = await fetch('/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.games = (data.games || []).filter((g) => g && g.slug && g.name && g.url);
  } catch {
    list.setAttribute('aria-busy', 'false');
    list.replaceChildren(h('li', { class: 'empty' }, h('b', { text: 'Could not load the games' }), h('span', { text: 'Check your connection and pull to refresh.' })));
    return;
  }
  if (!state.games.length) {
    list.setAttribute('aria-busy', 'false');
    list.replaceChildren(h('li', { class: 'empty' }, h('b', { text: 'No games yet' }), h('span', { text: 'New games appear here automatically.' })));
    return;
  }
  renderTags();
  render();
  const want = new URLSearchParams(location.search).get('g');
  if (want) openDetail(want, false);
}

async function startStats() {
  const backend = await connect();
  state.backend = backend;
  if (!backend) {
    $('#stats-note').textContent = 'Live stats are unavailable right now.';
    render();
    return;
  }
  backend.watchStats((s) => { state.stats = s; render(); });
  backend.watchOnline((o) => { state.online = o; render(); });
  try {
    state.votes = await backend.myVotes(state.games.map((g) => g.slug));
    store.set('hub.votes', state.votes);
  } catch { /* keep the mirrored votes */ }
  render();
}

// after the page's load event (which may already have fired while games.json was loading)
const whenLoaded = (fn) => { if (document.readyState === 'complete') fn(); else addEventListener('load', fn, { once: true }); };
if ('serviceWorker' in navigator) whenLoaded(() => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
await loadGames();
// Firebase is lazy: it loads after the page has finished loading, and the list never waits for it.
whenLoaded(() => startStats());
