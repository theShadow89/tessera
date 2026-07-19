# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Keep it
current when the architecture or workflow changes.

## What this is

Tessera splits 3D models into parts that fit a printer's build volume and joins
them with connectors. It runs **entirely client-side** in the browser (models
never leave the machine) and can also be packaged as a desktop app (Tauri).
Stack: **React + Vite + three.js**, geometry via **`manifold-3d` (WASM) in a Web
Worker**, plus an optional bring-your-own-key **AI assistant**.

## Commands

```bash
npm install          # or: make install
npm run dev          # dev server on http://localhost:5175  (make dev)
npm run build        # static bundle -> dist/               (make build)
npm run preview      # serve the built bundle               (make preview)
npm test             # Vitest unit suite (make test)
make help            # list all Make targets
```

Desktop (needs the Rust toolchain, https://rustup.rs):

```bash
npx tauri icon src-tauri/app-icon.png   # generate icons (not committed)
npm run tauri:dev                        # make desktop-dev
npm run tauri:build                      # make desktop
```

**Always run `npm test` before committing.** The tests are fast (<1s) and are
the CI release gate.

## Architecture

```
src/
  App.jsx                 orchestration + state
  ui/Controls.jsx         side panel
  viewer/Scene.js         three.js renderer, exploded view
  geometry/
    loaders.js            STL/OBJ/3MF -> BufferGeometry (mm)
    meshBridge.js         three <-> manifold flat arrays, vertex weld
    manifoldWorker.js     WASM CSG: split by planes (runs OFF the main thread)
    manifoldClient.js     promise wrapper around the worker
    connectors.js         pins / inserts / magnets / dovetails at each interface
    repair.js             weld / degenerate removal / hole fill for broken meshes
    exporter.js           per-part STL / single ZIP download
    zip.js                dependency-free STORE-method ZIP writer + CRC32
  core/
    partition.js          bbox + printer volume -> auto cut planes
    planes.js             axis/normal helpers, manual planes, part-count estimate
    optimize.js           seam-aware cut placement (DP over sampled cross-sections)
  agent/
    tools.js              tool schemas + system prompts (chat + proactive)
    providers.js          Claude + OpenAI-compatible providers (normalized loop)
    agentClient.js        provider-agnostic agent loop
    platformFetch.js      Tauri HTTP plugin in the app, window.fetch in the browser
    AgentPanel.jsx        chat UI, provider config, proactive proposals
src-tauri/                native desktop shell (Tauri v2; registers the HTTP plugin)
```

`core/` and `geometry/` are **deterministic and UI-free by design** — the AI
assistant drives them as a set of tools (`agent/tools.js`). Keep them free of
React/DOM so both the UI and the agent can call them.

## Non-obvious constraints (read before editing)

- **Cross-origin isolation is required.** The WASM worker needs COOP/COEP
  headers (`Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Embedder-Policy: require-corp`). They are set in
  `vite.config.js` for both `server` and `preview`, and in `docker/nginx.conf`
  for the container. If you serve `dist/` any other way, replicate them or the
  geometry engine will not start.
- **manifold-3d runs in a Web Worker** (`manifoldWorker.js`), never on the main
  thread. `new Manifold(mesh)` **throws** on invalid topology (it does not set a
  status) — construction is wrapped in try/catch in `buildRoot`.
- **Connectors are placed per final interface** (never shared across >2 parts),
  by testing a centre-first candidate grid against the real material, so they
  land where there is material even on concave/necked cross-sections. A
  cross-section too small for one connector + its wall gets none — that is
  intended, not a bug.
- **Units:** STL/3MF are assumed millimetres; OBJ is unitless.
- **Provider abstraction:** the agent loop is normalized; `providers.js`
  translates to/from Anthropic (content blocks) and OpenAI-compatible
  (`tool_calls`) wire formats. The key is stored in `localStorage` and sent
  directly to the chosen endpoint — there is no backend.
- **No dependency bloat.** `zip.js` is a hand-rolled STORE ZIP writer on purpose
  (avoids a dep for one reliable multi-file download). Prefer this bias.
- **Tauri icons are generated, not committed** — from `src-tauri/app-icon.png`
  (a placeholder; swap in the real logo). `tauri build` fails without them; the
  CI generates them in-job.

## Conventions

- Match the style of the surrounding file (comment density, naming, idioms).
- Add tests in `tests/` (Vitest) for new geometry/agent logic; they are the
  fastest feedback loop and the release gate.
- Keep geometry/core UI-free (see above).

## CI & release

- `.github/workflows/release.yml` triggers on a version tag (`v*`). It runs a
  `test` gate, then builds **desktop installers** on a native runner matrix
  (macOS universal `.dmg`, Windows `.msi`, Linux `.deb`/AppImage — Tauri cannot
  cross-compile) and a **web container image** pushed to GHCR.
- Desktop builds are unsigned (Gatekeeper/SmartScreen warn on first launch).

## Branching (gitflow)

- `main` — production; releases are tagged here (`vX.Y.Z`).
- `develop` — integration; feature branches (`feature/*`) start from it.
- Bump the version in **both** `package.json` and `src-tauri/tauri.conf.json`
  (Tauri does not read `package.json`); the release tag must match.
