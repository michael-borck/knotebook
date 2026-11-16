# Knotebook packs and store

Status: static catalogue + SHA-256 + Ed25519 signatures + pinned key. The default
store is signed; self-hosted catalogues can override the key at build time.

## Three artifacts

- **Pack** — `<slug>.knotebook.json`, built by Studio. Self-contained: manifest,
  compiled ink JSON, assets and cover as data URLs. Plays without a store.
- **Catalogue** — `catalogue.json`, a static list of packs with hashes and URLs.
- **Store** — static hosting (GitHub Pages / Cloudflare) of the catalogue and the
  pack files. No backend, no accounts.

## Catalogue format

```json
{
  "format": "knotebook-catalogue",
  "version": 1,
  "generated": "2026-11-10T00:00:00.000Z",
  "packs": [
    {
      "id": "the-lantern-keepers",
      "title": "The Lantern Keepers",
      "author": "Knotebook",
      "theme": "noir",
      "sha256": "…",
      "url": "sample.knotebook.json",
      "description": "Demo pack.",
      "licence": "CC BY 4.0"
    }
  ]
}
```

`url` may be relative to the catalogue or absolute.

## Building a catalogue

```bash
npm run store:build -- --dir ./packs --base https://example.com/packs/ --out ./packs/catalogue.json
```

- Scans `--dir` for `*.knotebook.json`.
- Computes SHA-256 over each file.
- Writes the catalogue.

Bundled demo:

```bash
npm run store:demo
# writes public/sample.knotebook.json and public/catalogue.json
```

## Signing

Generate a keypair once:

```bash
npm run keys:generate
# keys/store-public.txt  — commit; the default app pins this key
# keys/store-secret.txt  — gitignored; keep offline
```

Build a signed catalogue:

```bash
npm run store:build -- \
  --dir ./packs \
  --base https://example.com/packs/ \
  --key keys/store-secret.txt \
  --out ./packs/catalogue.json
```

Each entry gets a `signature`; the catalogue gets a `publicKey`.

Player verification:

- The default store pins the public key in `src/lib/catalogue.ts`
  (`PINNED_STORE_PUBLIC_KEY`).
- `VITE_STORE_PUBLIC_KEY` overrides the pin for a self-hosted catalogue.
- A custom `?store=` catalogue without an override uses the key from the
  catalogue and is labelled "Catalogue-provided key — this store is trusted by
  the host".
- No key → hash-only install, labelled "Unsigned catalogue".

Pinning the key is the secure mode: a tampered catalogue cannot swap both the
key and the signature.

## Player store

- Open **Store** in the player.
- URL resolution order: `?store=<url>` → `VITE_CATALOGUE_URL` → `./catalogue.json`.
- Install: download → **SHA-256 check** → **Ed25519 signature** → schema and
  story validation → IndexedDB.
- Packs are capped at 16 MB; catalogues at 2 MB.
- Direct **Import pack** stays available for sideloading and classrooms.

## Submission model (PR, Lorekeeper-style)

Planned public repos:

```
knotebook-packs/        submission queue
  templates/submission.json
  submissions/<pack-id>/pack.knotebook.json
  submissions/<pack-id>/submission.json
  scripts/validate_pack.py (or .ts)
  .github/workflows/ci.yml

knotebook-store/        published site
  catalogue.json
  packs/*.knotebook.json
```

Flow:

1. Author builds a pack in Studio.
2. Opens a PR against `knotebook-packs` with the pack + submission metadata.
3. CI validates schema, metadata, hash, licence fields.
4. Maintainer reviews.
5. Maintainer signs the pack and rebuilds the catalogue.
6. The built site deploys to `knotebook-store`.

A merged PR is **not** live until the deploy completes. Corrections ship as a new
pack version.

## Security

- Packs are **inert data** (compiled ink + assets). No arbitrary HTML/JS.
- SHA-256 prevents corrupt or swapped downloads.
- Ed25519 signatures prove publisher provenance; the default catalogue key is
  pinned in the app.
- The standalone HTML export escapes story text and assets; exported files do
  not include a CSP.
- Keep `keys/store-secret.txt` offline. To rotate, generate a new keypair, re-sign
  the catalogue, update `PINNED_STORE_PUBLIC_KEY`, and publish.

## Who it is for

| Role | Effort | Action |
|---|---|---|
| Reader | none | Player → Store → Install |
| Teacher / student | none | Import a pack file |
| Author | low | Studio → Build pack → PR |
| Store operator | high | keys, CI, catalogue, deploy, review |
| Self-hoster | medium | host catalogue + packs, point the app at it |

## Next

1. Scaffold `knotebook-packs` and `knotebook-store`.
2. Catalogue theme filters.
3. Pack version negotiation for future pack formats.
