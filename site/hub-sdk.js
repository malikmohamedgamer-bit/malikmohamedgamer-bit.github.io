/*! Game Hub SDK — loaded by every game:  <script src="/hub-sdk.js" async></script>
 *  Optional attributes on that tag: data-hub-corner="top-left|top-right|bottom-left|bottom-right" (default top-left),
 *  data-hub-slug="my-game" (default: read from the game's own /<repo>/game.json).
 *  - counts a play at most once per 30 minutes per device per game
 *  - keeps presence while the game tab is open ("online" = in the game right now)
 *  - shows a small "← Hub" button only when running as an installed app (no browser back button there),
 *    hidden during pointer lock and fullscreen, and it never takes input away from the game
 *  - loads Firebase lazily after the page's load event; every step is wrapped and fails silently
 */
(function () {
  'use strict';
  if (window.__gameHubSdk) return;
  window.__gameHubSdk = true;

  var script = document.currentScript;
  var attr = function (n) { try { return script && script.getAttribute(n); } catch (e) { return null; } };
  var CORNERS = { 'top-left': 1, 'top-right': 1, 'bottom-left': 1, 'bottom-right': 1 };
  var corner = CORNERS[attr('data-hub-corner')] ? attr('data-hub-corner') : 'top-left';
  var COOLDOWN = 30 * 60 * 1000;

  function store(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  function appMode() {
    try {
      return navigator.standalone === true || ['standalone', 'fullscreen', 'minimal-ui'].some(function (m) { return matchMedia('(display-mode: ' + m + ')').matches; });
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- "← Hub" button (installed app only)
  function mountButton() {
    if (!appMode() || !document.body) return;
    var host = document.createElement('div');
    host.setAttribute('data-game-hub', '');
    host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;' +
      (corner.indexOf('top') === 0 ? 'top:max(8px,env(safe-area-inset-top));' : 'bottom:max(8px,env(safe-area-inset-bottom));') +
      (corner.indexOf('left') > 0 ? 'left:max(8px,env(safe-area-inset-left));' : 'right:max(8px,env(safe-area-inset-right));');
    var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    root.innerHTML = '<style>a{pointer-events:auto;display:inline-flex;align-items:center;gap:4px;height:34px;padding:0 12px;' +
      'border-radius:17px;background:rgba(10,12,16,.55);color:#fff;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'text-decoration:none;opacity:.6;border:1px solid rgba(255,255,255,.22);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);' +
      'transition:opacity .15s ease;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none}' +
      'a:hover,a:focus-visible{opacity:1}a:focus-visible{outline:2px solid #22D3EE;outline-offset:2px}' +
      'a::before{content:"";position:absolute;inset:-6px}a{position:relative}</style>' +
      '<a href="/" aria-label="Back to Game Hub">&larr; Hub</a>';
    var a = root.querySelector('a');
    // keep the game from seeing presses on the button (no shots fired, no pointer lock requested)
    ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'contextmenu'].forEach(function (t) {
      a.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });
    function sync() {
      var hide = !!(document.pointerLockElement || document.fullscreenElement || document.webkitFullscreenElement);
      host.style.display = hide ? 'none' : '';
    }
    ['pointerlockchange', 'fullscreenchange', 'webkitfullscreenchange'].forEach(function (t) { document.addEventListener(t, sync); });
    sync();
    document.body.appendChild(host);
  }

  // ---------------------------------------------------------------- slug
  function findSlug() {
    var s = attr('data-hub-slug');
    if (s) return Promise.resolve(s);
    var seg = location.pathname.split('/')[1] || '';
    var key = 'hub.slug:' + seg;
    var cached = null;
    try { cached = sessionStorage.getItem(key); } catch (e) { /* ignore */ }
    if (cached) return Promise.resolve(cached);
    return fetch('/' + seg + (seg ? '/' : '') + 'game.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) {
        var slug = g && typeof g.slug === 'string' ? g.slug : null;
        if (slug) try { sessionStorage.setItem(key, slug); } catch (e) { /* ignore */ }
        return slug;
      });
  }

  // ---------------------------------------------------------------- stats
  function startStats(slug) {
    var recent = store('hub.recent', {});
    recent[slug] = Date.now();
    save('hub.recent', recent); // the hub's "Recently played" tab (same origin)
    if (navigator.webdriver) return Promise.resolve(); // bots, crawlers and test runs never count as plays or players
    return import('/js/stats.js').then(function (m) { return m.connect(); }).then(function (backend) {
      if (!backend) return;
      var stop = backend.startPresence(slug);
      addEventListener('pagehide', function () { try { stop(); } catch (e) { /* ignore */ } });
      var last = store('hub.lastPlay', {});
      if (!(Date.now() - (last[slug] || 0) > COOLDOWN)) return;
      var mark = function () { last[slug] = Date.now(); save('hub.lastPlay', last); };
      return backend.registerPlay(slug).then(mark, mark); // refused = counted recently on the server: do not retry
    });
  }

  function boot() {
    try { mountButton(); } catch (e) { /* never break the game */ }
    setTimeout(function () { // after the game's own start-up work
      try {
        findSlug().then(function (slug) { if (slug && /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return startStats(slug); }).catch(function () { /* silent */ });
      } catch (e) { /* silent */ }
    }, 2500);
  }

  try {
    if (document.readyState === 'complete') boot(); else addEventListener('load', boot, { once: true });
  } catch (e) { /* silent */ }
})();
