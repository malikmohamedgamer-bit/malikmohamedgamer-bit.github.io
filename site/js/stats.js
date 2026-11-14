// Live stats backend (Firebase Realtime Database + Anonymous Auth), shared by the hub page and /hub-sdk.js.
// Everything here is optional: if /firebase-config.js has no config, or Firebase cannot load, connect()
// resolves to null and callers show "—". Nothing in here may throw into a game.
//
// Data model (see database.rules.json):
//   /stats/{slug}            {plays, likes, dislikes}   public read; counters move by ±1 only
//   /votes/{slug}/{uid}      1 | -1                       own node only, changed with the matching counter
//   /presence/{slug}/{uid}   server timestamp             own node only, removed by onDisconnect
//   /lastPlay/{slug}/{uid}   server timestamp             own node only, a play needs it > 30 min old
const FIREBASE_VERSION = '12.6.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
export const PLAY_COOLDOWN_MS = 30 * 60 * 1000;
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
export const PRESENCE_FRESH_MS = 5 * 60 * 1000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

let connecting = null;

/** Resolves to a backend object, or null when stats are unavailable. Never rejects. */
export function connect() {
  if (!connecting) connecting = open().catch((e) => { try { console.info('[hub] live stats unavailable:', e && e.message); } catch { /* ignore */ } return null; });
  return connecting;
}

async function open() {
  const { firebaseConfig } = await import('/firebase-config.js');
  if (!firebaseConfig || !firebaseConfig.databaseURL || !firebaseConfig.apiKey) return null;
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-database.js`),
  ]);
  const { emulator, ...config } = firebaseConfig;
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = dbMod.getDatabase(app);
  if (emulator) { // local tests only (tools/test-hub.mjs swaps in a config that points at the emulators)
    authMod.connectAuthEmulator(auth, `http://${emulator.auth}`, { disableWarnings: true });
    dbMod.connectDatabaseEmulator(db, emulator.db.split(':')[0], Number(emulator.db.split(':')[1]));
  }
  const user = auth.currentUser || (await authMod.signInAnonymously(auth)).user;
  return makeBackend(dbMod, db, user.uid);
}

function makeBackend(m, db, uid) {
  const { ref, onValue, update, set, get, increment, serverTimestamp, onDisconnect, off } = m;
  let offset = 0;
  onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  const serverNow = () => Date.now() + offset;
  const ok = (slug) => SLUG.test(slug);

  return {
    uid,
    serverNow,
    /** cb({slug: {plays, likes, dislikes}}) on every change. Returns an unsubscribe function. */
    watchStats(cb) {
      const r = ref(db, 'stats');
      const h = onValue(r, (s) => cb(s.val() || {}), () => cb(null));
      return () => off(r, 'value', h);
    },
    /** cb({slug: onlineCount}) on every change; entries older than PRESENCE_FRESH_MS are ignored. */
    watchOnline(cb) {
      const r = ref(db, 'presence');
      let last = {};
      const emit = () => {
        const now = serverNow();
        const counts = {};
        for (const [slug, users] of Object.entries(last)) {
          counts[slug] = Object.values(users || {}).filter((t) => typeof t === 'number' && now - t < PRESENCE_FRESH_MS).length;
        }
        cb(counts);
      };
      const h = onValue(r, (s) => { last = s.val() || {}; emit(); }, () => cb(null));
      const timer = setInterval(emit, 30 * 1000);
      return () => { clearInterval(timer); off(r, 'value', h); };
    },
    /** This device's vote for every slug it has voted on: {slug: 1|-1}. */
    async myVotes(slugs) {
      const out = {};
      await Promise.all(slugs.filter(ok).map(async (slug) => {
        const v = (await get(ref(db, `votes/${slug}/${uid}`))).val();
        if (v === 1 || v === -1) out[slug] = v;
      }));
      return out;
    },
    /** Set this device's vote: 1 (like), -1 (dislike) or 0 (none). One atomic multi-path update.
     *  onSent() runs the moment the write is handed to Firebase (its local events already include it). */
    async vote(slug, next, onSent) {
      if (!ok(slug) || ![1, -1, 0].includes(next)) throw new Error('bad vote');
      const prev = (await get(ref(db, `votes/${slug}/${uid}`))).val() || 0;
      if (prev === next) { if (onSent) onSent(); return next; }
      const u = { [`votes/${slug}/${uid}`]: next || null };
      const dl = (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
      const dd = (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
      if (dl) u[`stats/${slug}/likes`] = increment(dl);
      if (dd) u[`stats/${slug}/dislikes`] = increment(dd);
      const done = update(ref(db), u);
      if (onSent) onSent();
      await done;
      return next;
    },
    /** Count a play (the rules refuse it if this uid played this game in the last 30 minutes). */
    async registerPlay(slug) {
      if (!ok(slug)) return false;
      await update(ref(db), { [`stats/${slug}/plays`]: increment(1), [`lastPlay/${slug}/${uid}`]: serverTimestamp() });
      return true;
    },
    /** Mark this device as in the game while the page is open. Returns a stop function. */
    startPresence(slug) {
      if (!ok(slug)) return () => {};
      const me = ref(db, `presence/${slug}/${uid}`);
      const conn = ref(db, '.info/connected');
      const h = onValue(conn, (s) => {
        if (s.val() !== true) return;
        onDisconnect(me).remove().then(() => set(me, serverTimestamp())).catch(() => {});
      });
      const beat = setInterval(() => { set(me, serverTimestamp()).catch(() => {}); }, PRESENCE_HEARTBEAT_MS);
      return () => { clearInterval(beat); off(conn, 'value', h); set(me, null).catch(() => {}); };
    },
  };
}
