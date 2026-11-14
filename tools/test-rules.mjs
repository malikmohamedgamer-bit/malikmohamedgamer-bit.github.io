// Security-rules test with two anonymous users.
//   Emulator (default):  npx firebase-tools emulators:exec --only database,auth --project demo-gamehub "node tools/test-rules.mjs"
//   Live database:       node tools/test-rules.mjs --live      (uses site/firebase-config.js; writes under the test slug only)
// Every allowed write must succeed and every forbidden write must be refused.
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, ref, update, set, get, increment, serverTimestamp, connectDatabaseEmulator } from 'firebase/database';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const SLUG = live ? `zz-rules-test-${Date.now().toString(36)}` : 'test-game';
let config;
if (live) {
  ({ firebaseConfig: config } = await import(pathToFileURL(join(root, 'site', 'firebase-config.js'))));
  if (!config) { console.error('site/firebase-config.js has no config yet'); process.exit(2); }
} else {
  config = { apiKey: 'demo-key', projectId: 'demo-gamehub', databaseURL: 'http://127.0.0.1:9000?ns=demo-gamehub-default-rtdb', authDomain: 'demo-gamehub.firebaseapp.com' };
}

async function user(name) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (!live) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
  const { user: u } = await signInAnonymously(auth);
  return { app, db, uid: u.uid, name };
}

let pass = 0, fail = 0;
async function expectOk(label, fn) {
  try { await fn(); pass++; console.log(`  ok    allowed: ${label}`); } catch (e) { fail++; console.log(`  FAIL  should be allowed: ${label} (${e.code || e.message})`); }
}
async function expectDenied(label, fn) {
  try { await fn(); fail++; console.log(`  FAIL  should be refused: ${label}`); } catch (e) { if (/PERMISSION_DENIED|permission/i.test(String(e.code || e.message))) { pass++; console.log(`  ok    refused: ${label}`); } else { fail++; console.log(`  FAIL  unexpected error for ${label}: ${e.message}`); } }
}

const A = await user('A');
const B = await user('B');
const anonApp = initializeApp(config, 'anon');
const anonDb = getDatabase(anonApp);
if (!live) connectDatabaseEmulator(anonDb, '127.0.0.1', 9000);
const s = (p) => `stats/${SLUG}/${p}`;
const v = (u) => `votes/${SLUG}/${u.uid}`;
const val = async (db, p) => (await get(ref(db, p))).val();
console.log(`rules test on ${live ? 'the LIVE database' : 'the emulator'}, slug ${SLUG}`);

// ---- votes
await expectOk('A likes (vote 1 + likes +1)', () => update(ref(A.db), { [v(A)]: 1, [s('likes')]: increment(1) }));
await expectDenied('A likes again (already liked)', () => update(ref(A.db), { [v(A)]: 1, [s('likes')]: increment(1) }));
await expectDenied('likes +1 without a vote change', () => update(ref(B.db), { [s('likes')]: increment(1) }));
await expectDenied('vote without the matching counter', () => update(ref(B.db), { [v(B)]: 1 }));
await expectDenied('likes +2 with one vote', () => update(ref(B.db), { [v(B)]: 1, [s('likes')]: increment(2) }));
await expectDenied('dislikes +1 with a like vote', () => update(ref(B.db), { [v(B)]: 1, [s('dislikes')]: increment(1) }));
await expectDenied('A writes B\'s vote', () => update(ref(A.db), { [v(B)]: 1, [s('likes')]: increment(1) }));
await expectDenied('vote value 2', () => update(ref(B.db), { [v(B)]: 2, [s('likes')]: increment(1) }));
await expectOk('B likes', () => update(ref(B.db), { [v(B)]: 1, [s('likes')]: increment(1) }));
await expectOk('A switches to dislike (likes -1, dislikes +1)', () => update(ref(A.db), { [v(A)]: -1, [s('likes')]: increment(-1), [s('dislikes')]: increment(1) }));
await expectDenied('B switches to dislike but keeps the like', () => update(ref(B.db), { [v(B)]: -1, [s('dislikes')]: increment(1) }));
await expectDenied('B decrements dislikes it never cast', () => update(ref(B.db), { [s('dislikes')]: increment(-1) }));
await expectOk('A removes its vote (dislikes -1)', () => update(ref(A.db), { [v(A)]: null, [s('dislikes')]: increment(-1) }));
await expectDenied('A deletes the likes counter', () => set(ref(A.db, s('likes')), null));
await expectDenied('A sets likes to an arbitrary number', () => set(ref(A.db, s('likes')), 999));
await expectOk('A reads its own vote', () => get(ref(A.db, v(A))));
await expectDenied('A reads B\'s vote', () => get(ref(A.db, v(B))));
// ---- plays
await expectDenied('plays +1 without lastPlay', () => update(ref(A.db), { [s('plays')]: increment(1) }));
await expectDenied('lastPlay without plays +1', () => update(ref(A.db), { [`lastPlay/${SLUG}/${A.uid}`]: serverTimestamp() }));
await expectDenied('lastPlay with a client clock value', () => update(ref(A.db), { [s('plays')]: increment(1), [`lastPlay/${SLUG}/${A.uid}`]: Date.now() }));
await expectOk('A registers a play', () => update(ref(A.db), { [s('plays')]: increment(1), [`lastPlay/${SLUG}/${A.uid}`]: serverTimestamp() }));
await expectDenied('A plays again within 30 minutes', () => update(ref(A.db), { [s('plays')]: increment(1), [`lastPlay/${SLUG}/${A.uid}`]: serverTimestamp() }));
await expectDenied('A deletes its lastPlay to play again', () => set(ref(A.db, `lastPlay/${SLUG}/${A.uid}`), null));
await expectOk('B registers a play', () => update(ref(B.db), { [s('plays')]: increment(1), [`lastPlay/${SLUG}/${B.uid}`]: serverTimestamp() }));
await expectDenied('plays +2', () => update(ref(B.db), { [s('plays')]: increment(2), [`lastPlay/${SLUG}/${B.uid}`]: serverTimestamp() }));
// ---- presence
await expectOk('A sets its presence (server time)', () => set(ref(A.db, `presence/${SLUG}/${A.uid}`), serverTimestamp()));
await expectDenied('A sets presence with a fake time', () => set(ref(A.db, `presence/${SLUG}/${A.uid}`), 1234));
await expectDenied('A sets B\'s presence', () => set(ref(A.db, `presence/${SLUG}/${B.uid}`), serverTimestamp()));
await expectOk('anyone reads presence', () => get(ref(anonDb, `presence/${SLUG}`)));
await expectOk('A removes its presence', () => set(ref(A.db, `presence/${SLUG}/${A.uid}`), null));
// ---- validation and auth
await expectDenied('extra field under stats', () => set(ref(A.db, `stats/${SLUG}/hacked`), 1));
await expectDenied('bad slug format', () => update(ref(A.db), { [`votes/Bad_Slug/${A.uid}`]: 1, ['stats/Bad_Slug/likes']: increment(1) }));
await expectDenied('write outside the model', () => set(ref(A.db, `admin/${A.uid}`), true));
await expectDenied('signed-out write', () => set(ref(anonDb, `presence/${SLUG}/nobody`), serverTimestamp()));
await expectOk('signed-out read of stats', () => get(ref(anonDb, `stats/${SLUG}`)));

const final = await val(anonDb, `stats/${SLUG}`);
const expected = { plays: 2, likes: 1, dislikes: 0 };
const same = JSON.stringify({ plays: final?.plays, likes: final?.likes, dislikes: final?.dislikes ?? 0 }) === JSON.stringify(expected);
if (same) pass++; else fail++;
console.log(`  ${same ? 'ok   ' : 'FAIL '} final counters ${JSON.stringify(final)} (expected ${JSON.stringify(expected)})`);
if (live) console.log(`  note: test data left under stats/${SLUG}; the rules let no client delete it (harmless, never listed in the hub)`);

await Promise.all([deleteApp(A.app), deleteApp(B.app), deleteApp(anonApp)]);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
