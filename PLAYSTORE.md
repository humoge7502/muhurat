# Muhurat on Google Play — the exact path

Muhurat is built as an installable **PWA**, which is the fastest honest route to
Android: installable today from Chrome, and wrap-able into a signed Play Store
build (Trusted Web Activity) without rewriting a line.

## What only you (the account owner) can do

No process on any machine can do these — they bind to your identity and money:

1. **Create the Google Play Developer account** — https://play.google.com/console
   (one-time $25 registration, identity verification, usually 48 h approval).
2. **Accept the Developer Distribution Agreement** and complete the data-safety
   form (Muhurat collects no personal data server-side; saved items are local —
   that is the honest declaration).

## What is already prepared in this repo

- PWA manifest (`frontend/public/manifest.webmanifest`) with theme colors,
  standalone display and icons.
- Service worker (`frontend/public/sw.js`) — shell + API caching, the behaviour
  Play's "core quality" review looks for in TWAs.
- The public key fingerprint step: after you own the signing key,
  `bubblewrap` generates `assetlinks.json` content automatically (step 4 below).

## Steps to the store (performed from this repo's `frontend/`)

```bash
npm run build                       # dist/ is what the TWA wraps
npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest
npx @bubblewrap/cli build           # creates app-release-signed.aab + keystore
npx @bubblewrap/cli updateConfig    # keeps the TWA in sync with the manifest
```

Then:

1. Host the built frontend + backend on any HTTPS host (single container works —
   the API serves the SPA the same way SANJEEVANI does).
2. Publish `.well-known/assetlinks.json` (bubblewrap prints its exact JSON) on
   that domain — this is what removes the browser address bar in the TWA.
3. In Play Console: **Create app → Upload `app-release-signed.aab`** → store
   listing (screenshots: use `docs/assets/app-*.png` as the base) → roll out to
   internal testing → production.
4. Keep the keystore private and backed up; losing it means a new app listing.

## Updates the students "never miss"

- The feed updates itself server-side every 6 h (and on demand) — content
  freshness does not depend on store releases.
- The service worker picks up new shells on next visit; for force-updates bump
  the cache version constants in `sw.js`.
- Store-binary updates: `npx @bubblewrap/cli updateConfig` + version-bump in
  `bubblewrap.config.json` → new `.aab` → Play Console upload (your account).

## Honest boundary

Until the developer account exists, the **PWA is the shipping product**: open
the URL in Chrome → menu → *Install app* — it lands on the home screen, runs
standalone, works offline for cached data. Everything above the account wall is
already built.
