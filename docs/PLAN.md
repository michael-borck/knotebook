# Knotebook — build plan

Status: **All phases complete.** Last updated: 2026-11-16.

## Product

An **LLM-friendly studio for general branching stories**, with a real distribution
channel (packs + store). Not another general ink IDE.

## Principles

- **ink is the source of truth.** Compile and run in-browser with `inkjs`; no
  native compiler binary and no Python build step.
- **Studio vs Player.** Tauri desktop app for authoring; PWA for reading. One
  pack format, no forks.
- **Themes are shared.** Reuse the 21 art sets already in
  `swipeverse-store/art` (noir, kingdom, cyberpunk, …).
- **Safe by default.** Packs are inert data (compiled ink + assets). No arbitrary
  HTML/JS in packs.
- **No backend** until a paid-pack need is proven. Static catalogue + GitHub
  Pages, like `swipeverse-store` and `lorekeeper-packs`.

## Architecture

```
core        compile, lint, bible, pack, theme (shared, no UI)
studio      Tauri + React + CodeMirror 6 + inkjs  (authoring)
player      PWA that installs packs and plays offline
store       static catalogue + signing (separate repo)
themes      theme registry derived from swipeverse-store/art
```

Today everything lives in one Vite app. Split into `packages/core` /
`apps/studio` / `apps/player` when the player lands (Phase 2).

## Repo layout (current)

```
src/                 React app (studio)
  lib/ink.ts         compile + play
  lib/lint.ts        conventions + word count
  lib/bible.ts       story bible + LLM prompt
  lib/exportHtml.ts  standalone HTML reader
  lib/inkRuntime.ts  inlined inkjs runtime for export
  lib/platform.ts    Tauri vs browser file I/O
  samples/story.ink  demo story
src-tauri/           Tauri 2 shell + read/write commands
scripts/smoke.ts     compile/play/lint/export smoke test
docs/PLAN.md         this file
```

## Roadmap

### Phase 0 — editor spike (done)
Tauri shell, CodeMirror ink editor, in-browser compile, live preview, issue
list, story bible, LLM prompt, standalone HTML export, smoke test.

**Verified:** `npm run build`, `npm run smoke`, `cargo check`, dev server 200.

### Phase 1 — real Studio core (done, except assets)
- Project folder: open folder, file tree with `INCLUDE`, asset folder.
- **Multi-file compile:** an in-memory inkjs file handler resolves `INCLUDE`
  from the project's `.ink` files, relative to the root file's folder (as
  `inklecate` does).
- Autosave + timestamped backups under `.knotebook/backups/`.
- `knotebook.bible.json` stored in the project.
- Theme registry + picker; preview and export follow the theme.
- Click an issue to jump to its line.
- Shortcuts: save, open, export.

Exit: author a multi-file story, theme it, export it, reopen it.

### Phase 1.5 — structure view
React Flow knot graph (InkVisual model), coverage, dead-end/unreachable
highlighting.

**First cut (implemented):**
- `src/lib/graph.ts` parses knots and diverts, including files pulled in by
  `INCLUDE`; entry knots and missing targets are detected.
- `src/components/KnotGraph.tsx` lays the graph out with dagre and renders it
  with React Flow.
- Studio **Text / Map** toggle; the map is the default view. Click a knot to
  open a side drawer and edit just that knot; chevrons expand/collapse branches,
  and loop-backs are dashed amber edges with a cycle-aware layout.
- Nodes are draggable; manual positions and collapsed branches persist in
  localStorage. `# note:` and `# group:` / `# chapter:` tags annotate nodes and
  colour groups without changing the ink flow.
- Use **Open in text** in the drawer to jump to the knot's line; the entry knot
  is highlighted and missing targets are red.
- **Coverage**: knots visited by the live preview get a green dot; the legend
  shows `X/Y covered`.
- **Dead ends**: a knot with no diverts, no choices and no `-> END` is flagged.
- **Unreachable**: knots not reachable from the entry are dimmed with a dashed
  border.
- **Stitches** are nodes too (`knot.stitch`), resolved for `-> knot.stitch` and
  relative `-> stitch` diverts.
- Coverage persists per project/file in `localStorage`, survives recompiles, and
  has a **Reset** control in the graph legend.
- `?view=map` opens the Studio directly on the map.

### Phase 2 — pack + player
Freeze `pack.json` + theme schema. Studio builds a pack. PWA player installs to
IndexedDB, plays offline, saves progress, renders themes.

Exit: install a pack, play offline, progress survives reload.

**First cut (implemented):**
- `src/lib/pack.ts` — `knotebook-pack` v1, `buildPack`, `parsePack`.
- Studio **Build pack** writes `<slug>.knotebook.json` (manifest + compiled
  story JSON + `assets` as data URLs + optional `cover`).
- Project **assets**: `assets/` listing, **Add image…**, and `cover.*`
  auto-detected as the pack cover; if there is no `cover.*`, the first image
  asset is used.
- Player at `?player=1` (`src/Player.tsx`): import pack, library, play, restore
  progress, restart, themes, cover art, and scene images from `# image:` /
  `# bg:` tags that point at `assets/...`.
- Library keeps installed packs, the full **recently played** list, and
  **per-pack version history**; the Store filters by All / Installed / Updates
  and by theme.
- Standalone **HTML export** now embeds `cover` + `assets` and renders scene
  images, matching the pack artifact.
- Storage is **IndexedDB** (`src/lib/storage.ts`: `packs`, `progress`, `library`,
  `history`, `packHistory`).
- PWA shell: `public/manifest.webmanifest`, `public/sw.js`, icons; the service
  worker registers in browsers only (not in Tauri).

### Phase 3 — store + signing
Static catalogue, CI validation, sha256 + Ed25519 signature,
`knotebook-packs` submission repo, `knotebook-store` site, theme filters.

Exit: third-party PR → reviewed → signed → installable.

**First cut (implemented):**
- `src/lib/catalogue.ts` — `knotebook-catalogue` v1, `parseCatalogue`,
  `sha256Hex`, `fetchPackBytes`.
- **Ed25519 signing** (`tweetnacl`): `keys:generate`, `store:build --key`,
  player verification. The default store pins the public key in
  `src/lib/catalogue.ts`; `VITE_STORE_PUBLIC_KEY` overrides it for self-hosted
  catalogues.
- `scripts/build-catalogue.ts` — hash and sign a folder of packs into a catalogue.
- `scripts/make-sample-pack.ts` — bundled signed demo store in `public/`.
- Player **Store** tab: catalogue URL via `?store=` / `VITE_CATALOGUE_URL` /
  `./catalogue.json`; install verifies **SHA-256** and **signature** before
  IndexedDB. Packs and catalogues have size caps, and the store filters packs by
  theme.
- `docs/STORE.md`, `templates/submission.json`.
- `knotebook-packs`: submission queue with schema validation and CI.
- `knotebook-store`: static storefront, signed catalogue, verifier, theme filters,
  strict CSP, and Pages deploy.

### Phase 4 — LLM loop (differentiator)
Bible + conventions as the generation contract; per-knot structured edits with
diff review; compile/lint auto-retry; snapshots/rollback. BYO keys, optional
local Ollama.

**First cut (implemented):**
- AI tab with provider settings (Ollama / OpenAI-compatible).
- Sends the bible + script; shows the returned ink as a line diff.
- Apply/discard, with up to 10 snapshots per project/file and restore.
- **Fix compile errors** sends the current errors back to the model.
- **Per-knot structured edits**: selecting a knot sends only that knot (plus
  other knot names as context), merges the revision back into the script, and
  shows a knot-scoped diff.
- **Multi-knot structured edits**: the "Multiple knots" scope sends a JSON
  request, parses a `{ knot: source }` map, validates every key, and merges the
  selected knots with one scoped diff.
- **Token streaming**: OpenAI-compatible SSE is parsed incrementally and the live
  diff updates while the model writes.
- **Automatic retry loop**: failed revisions go back to the model with the
  compile/lint errors (up to 3 attempts); scoped retries ask for only the knot.
- **OS keychain**: the API key is stored with the Rust `keyring` crate (macOS
  Keychain, Windows Credential Manager, Linux Secret Service); the web app
  falls back to browser storage and legacy keys are migrated automatically.
- Phase 4 is complete.

### Phase 5 — publish + export
PWA build, Tauri release matrix, auto-update. Then H5P / ChoiceScript / Twine
exporters for a constrained subset.

**Implemented so far:** the PWA is published to the public `knotebook-site` repo;
pushes to `main` build and publish automatically via GitHub Actions with an SSH
deploy key. The site now has a landing page at the root and the app/player at
`/app/`, with platform-aware download links to GitHub releases and the
`knotebook.borck.education` custom domain. A tag-gated `release.yml` runs a
preflight gate (typecheck, lint, smoke), builds on `macos-15`, Ubuntu 22.04 and
Windows, signs/notarizes macOS through a shared
[`apple-signing`](../.github/actions/apple-signing/action.yml) composite action,
and creates a draft release. Windows and Linux are unsigned. Manual dispatch runs
the notarize-check only. This follows the app-hq Tauri API-key pattern.
**Auto-update is wired from v0.1.1**: the app checks
`releases/latest/download/latest.json`, downloads signed updater artifacts and
prompts to install and restart. The per-app updater public key is in
`tauri.conf.json`.

**Exporters (implemented):**
- **HTML** — self-contained reader with the ink runtime, theme, cover and assets.
- **H5P** — `.h5p` package with a custom `H5P.KnotebookStory` library that
  embeds the HTML reader in a sandboxed iframe.
- **ChoiceScript** — `.txt` with labels, `*choice`, `*goto`, `*finish`,
  `*create` and `*set`.
- **Twine (Twee)** — `.twee` with passages, links, tags and `<<set>>`.
- The text exporters cover a constrained subset: knots, stitches, text, choices,
  diverts, tags, `VAR` declarations and simple `~` assignments. Unsupported ink
  constructs are exported as-is for manual cleanup.
- Phase 5 is complete.

### Phase 6 — polish
Icon, signing/notarization, GitHub Actions release workflow, docs,
accessibility.

**Implemented:**
- App and PWA icons, including maskable variants.
- Tag-gated release workflow with preflight checks and macOS notarization.
- README, `docs/PLAN.md`, `docs/STORE.md`, and storefront/submission docs.
- Accessibility: visible focus rings, heading/landmark structure, labelled
  forms, `aria-live` story/toast updates, `aria-pressed`/`aria-current` state,
  and a keyboard-focusable knot map.
- Phase 6 is complete.

## Decisions

| Decision | Choice |
|---|---|
| Repo layout | App monorepo; separate `knotebook-packs` + `knotebook-store` content repos |
| Player tech | Share core; one React codebase for now |
| Theme IDs | Canonical `kingdom`; alias `mystical → kingdom`; keep `base` |
| Signing | Ed25519 + sha256 from Phase 3 |
| Pack storage | IndexedDB (`packs` + `progress` stores) |
| Player route | Same build, `?player=1`; separate bundle later if needed |
| LLM | BYO key; Tauri keychain, PWA localStorage; Ollama; diff-based edits |
| Accounts / backend | None until proven |
| Export formats | Defer until the pack loop is smooth |

## Themes

Source of truth: `retroverse/swipeverse-store/art/index.json`.

- Sets: aviation, business, cybersecurity, egypt, gothic, kingdom, medical,
  military, mythology, nautical, noir, pirate, postapoc, prehistoric, samurai,
  science, sport, steampunk, underwater, university, viking, western (+ base).
- Paths: `art/<set>/<archetype>.webp`, `art/<set>/back.webp`,
  `art/<set>/badges/<slot>.webp`.
- Archetypes: crisis, opportunity, judgement, faction, advisor, petitioner,
  gamble, chain, terminal.

## Draft pack format

```
pack.json
  id, version, title, author, licence, tags, level, pitch, cover, theme
  compatibility: { ink: "2.4.0", player: ">=1.0" }
  stories: [ { id, title, path, start } ]
  sha256, signature
stories/*.json     compiled ink
assets/*           images, audio
```

## Dev notes

- The repo is on an **exFAT** volume, so macOS creates AppleDouble `._*` files.
  Cargo/Tauri build scripts choke on them. Before desktop builds:
  `npm run clean:appledouble`.
- Cargo's `target/` must be on APFS: the desktop scripts set
  `CARGO_TARGET_DIR=$HOME/Library/Caches/knotebook-target`.
- **Strong recommendation:** move the repo to local APFS; that removes both
  workarounds.
- Commands: `npm run dev`, `npm run build`, `npm run smoke`,
  `npm run desktop:dev`, `npm run desktop:build`.
- Studio: `/`; Player: `/?player=1`. The Studio toolbar has a **Player** button.

## Verification (Phase 0)

- `npm run build` — typecheck + bundle passes.
- `npm run smoke` — compile, play, lint, export round-trip.
- `cargo check` — Tauri shell builds.
- `npm run dev` — server responds 200 with the Knotebook page.
