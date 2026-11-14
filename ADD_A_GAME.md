# Add a game to Game Hub

Game Hub finds games by itself. A browser game appears at https://malikmohamedgamer-bit.github.io/ once its
**public** repo has the topic `hub-game` and its GitHub Pages site serves a valid `game.json`. The hub's
discovery Action runs on every hub push, once a day, and on demand (Actions → "Discover games and deploy" → Run).

## Checklist (do all of it, in the game's own repo)

Work on a `hub-ready` branch, test, then merge into the branch Pages deploys from and push. Never rename the
repo (Pages URLs don't redirect); change the name only where it is displayed. If the game has a build step,
edit the source and confirm the Pages deploy actually updated.

1. **Name and copy**
   - Name: catchy, 20 characters or fewer, true to the game.
   - Tagline: 60 characters max (shown in the hub list, coloured).
   - Short description: 160 characters max (meta description and share text).
   - Long description: 2–4 sentences, plus the controls.
2. **Icon set** in the hub's family style (same frame, corner radius and lighting; one bold emblem that reads at
   48 px; a colour of its own). Add the emblem to `tools/icons.mjs` in the hub repo, run
   `node tools/icons.mjs`, look at `tools/out/icons/sheet.png` at small sizes and redo anything muddy. Copy into
   the game's `assets/icons/`:
   `favicon.svg`, `favicon-32.png`, `favicon.ico`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`,
   `icon-maskable-512.png` (key art inside the central 80%).
3. **Banner**: a real 1280×720 gameplay screenshot taken with Playwright (add a flow to `tools/banners.mjs`
   in the hub repo, run `node tools/banners.mjs <slug>`), saved as `assets/banner.jpg`.
4. **Page metadata** in the game's `index.html`:
   - `manifest.webmanifest`: `name`, `short_name`, icons (incl. maskable), `theme_color`, `background_color`,
     `display: "standalone"`, `start_url` and `scope` = the game's own path (`"./"` next to index.html), `id`.
   - `<title>`, `<meta name="description">`, `<meta name="theme-color">`, `<link rel="apple-touch-icon">`,
     favicon links, `<link rel="manifest">`.
   - Open Graph + Twitter card tags with **absolute** URLs (`og:title`, `og:description`, `og:url`, `og:image` =
     the banner, `twitter:card` = `summary_large_image`).
5. **`game.json`** at the deployed site root (`https://malikmohamedgamer-bit.github.io/<Repo>/game.json`):
   ```json
   {
     "slug": "my-game",
     "name": "My Game",
     "tagline": "≤ 60 chars",
     "description": "≤ 160 chars",
     "longDescription": "2-4 sentences.",
     "tags": ["Genre", "3D"],
     "controls": ["Move: WASD", "Jump: Space"],
     "platforms": ["desktop", "mobile"],
     "icon": "https://malikmohamedgamer-bit.github.io/<Repo>/assets/icons/icon-192.png",
     "banner": "https://malikmohamedgamer-bit.github.io/<Repo>/assets/banner.jpg",
     "url": "https://malikmohamedgamer-bit.github.io/<Repo>/",
     "repo": "https://github.com/malikmohamedgamer-bit/<Repo>",
     "color": "#RRGGBB",
     "addedAt": "2026-11-14T00:00:00Z"
   }
   ```
   Rules (enforced by `tools/discover.mjs`): slug = lowercase letters, digits, dashes (max 40) and unique;
   1–6 tags of ≤ 20 chars; controls = strings, `"Action: keys"` renders the action in bold; platforms ⊆
   `desktop`, `mobile` (list `mobile` only if the game has working touch controls that were tested, at least in touch emulation); URLs absolute https;
   `repo` must be this repo; `color` optional. Check it from the hub repo with
   `node tools/discover.mjs --validate ../<Repo>/game.json`.
   If the game has a build step, make sure the build copies `game.json`, `manifest.webmanifest`, `assets/banner.jpg`
   and `assets/icons/` into the deployed folder.
6. **Repo settings**:
   ```bash
   gh repo edit malikmohamedgamer-bit/<Repo> --add-topic hub-game --description "<Name>: <tagline>" --homepage https://malikmohamedgamer-bit.github.io/<Repo>/
   ```
7. **Hub script**: one line before `</body>`:
   ```html
   <script src="/hub-sdk.js" async></script>
   ```
   Optional: `data-hub-corner="top-left|top-right|bottom-left|bottom-right"` for the "← Hub" button (pick the
   corner the game's HUD leaves free). The SDK counts plays, keeps presence, and only shows "← Hub" in the
   installed app. If the game's own dev server or tests forbid absolute paths or 404s, serve a no-op
   `/hub-sdk.js` from the dev server (see Riftkeep's `tools/dev-server.mjs`). If the game has its own service
   worker, make it ignore URLs outside its scope (`if (!url.href.startsWith(self.registration.scope)) return;`)
   so the hub's shared files are never cached by the game.
8. **Before/after check**: the game loads with no new console errors and still plays (start it and send input).
   Pointer lock and fullscreen must still work. After pushing, wait for the Pages build
   (`gh api repos/malikmohamedgamer-bit/<Repo>/pages/builds/latest`, or the Actions run for Actions-deployed
   sites), check the live URL and `game.json` return 200, then run the hub's discovery
   (`gh workflow run discover.yml -R malikmohamedgamer-bit/malikmohamedgamer-bit.github.io`) and check the game
   appears in the hub.

## Ready-to-paste prompt for a Claude Code session

> Make this game hub-ready for Game Hub. Follow `ADD_A_GAME.md` in
> `C:\Users\Malik\GameHub\malikmohamedgamer-bit.github.io` exactly (the hub repo is
> malikmohamedgamer-bit/malikmohamedgamer-bit.github.io). Read the game's code first so the name, tagline,
> descriptions, tags, controls and platforms are accurate; never invent features. Work on a `hub-ready` branch,
> design the icon in the hub's family style with `tools/icons.mjs`, take a real gameplay banner with
> `tools/banners.mjs`, add the manifest, meta tags, `game.json`, repo topic/description/homepage and the
> `/hub-sdk.js` line, then test that the game still loads without new console errors and still plays. Merge into
> the Pages branch, push, wait for the deploy, run the hub's discovery workflow and confirm the game is listed
> at https://malikmohamedgamer-bit.github.io/. Don't change repo visibility, rename repos or force-push.
