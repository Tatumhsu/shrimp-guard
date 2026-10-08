# Publication safety handoff — 2026-10-08

Local branch: `safety/publication-projects`; no push, PR, deployment, VPS access, domain, permission or security setting change performed.

## Current source and output

- main base: `1cd0b3116fc3890ca790c0ce7ad49f9132a7aa3b`.
- Published source base: `c1e7679273d2e7c0fcd4c9f00d43b0ad0ffa896d`.
- `publication/` contains all 164 original Git blobs byte for byte, including hidden lock file, legacy nested public tree, room GLB/vendor, and world-impact Blender/source files. `.gitattributes` disables newline conversion for baseline and overlays.
- `overlays/` is the only approved delta: homepage menu link plus `/projects/`. Existing articles are unchanged. The project page uses the existing published stylesheet with small responsive styles.
- `scripts/build_publication.py` is the sole candidate publication builder. It verifies baseline SHA-256, composes a clean output, then rejects any difference from `verification/allowlist.json`. It preserves the published CNAME; obsolete root CNAME is not used.
- The old competing deploy workflows are removed in this branch. `publication.yml` only validates and uploads a review artifact; it has no deployment action. This is a staging workflow, not an operational publishing workflow yet.
- Existing Hugo content is retained as historical authoring source but is NOT rebuilt or published by this candidate workflow. Migration back to regenerated Hugo output needs a separate reviewed file allowlist; do not run Hugo into the candidate output.

## Verification

- 5 unit tests passed (4 safety cases plus entry links/status/homepage delta).
- 164 baseline files verified against original Git blobs. Output: 165 files, 163 unchanged, 1 changed (`index.html` navigation only), 1 added (`projects/index.html`), 0 deleted.
- All room (13), world-impact (30), taipei-mrt (1), posts (5), and legacy public (59) files remain byte-identical.
- Five live HTTP 200 pages match baseline SHA-256: homepage, room, world-impact, taipei-mrt, ai-virtual-model-economy. Live CNAME URL returns 404; the Git CNAME is preserved and this is not evidence of a site failure.
- All project-page local link targets exist. Nine anchors include duplicate homepage navigation, six products and the LIFE test link nested under LIFE. External login services were not accessed; their availability is not inferred.
- `verification/result.json` contains full before/after file hashes; baseline, allowlist, live checks and Git byte-check results are adjacent.
- UI NOT VERIFIED: no available browser surfaces (browser inventory empty; in-app browser unavailable). Desktop/mobile screenshots, visual overflow, actual browser back/reload and interactive protected-app smoke tests remain outstanding. No screenshots are fabricated.

## Safe continuation / deployment gates

1. Review this local branch and all-file hash report. Complete desktop (e.g. 1440x900), mobile (390x844), local navigation, back and reload UI tests through a connected desktop browser.
2. Read existing GitHub Pages configuration with an authorized read-only account (GET repository Pages endpoint). Anonymous request returned 404; no deployment mode can be established from that response. Minimum missing capability is authenticated read of Pages configuration; do not change Pages mode or repository permissions.
3. Re-fetch main/gh-pages and compare both SHAs. If either changed, stop and reconcile a fresh immutable baseline and live hashes; never overwrite newer publication.
4. Only after the user review and confirmed existing deployment mode, wire ONE publishing job to this validated output using that mode. Do not reinstate both original workflows. Preserve current domain and existing permission scope. No keep_files workaround is needed: this output is complete.
5. Before release, compare produced output against the reviewed result and retain exact publication backup. After release, verify all preserved route hashes and the new entry URL.
6. Rollback uses the exact baseline tree through the SAME confirmed existing deployment mechanism, not an old Hugo rebuild. No rollback executed now.

## Exact backup

Sibling `publication-exact-c1e7679.zip` is the authoritative full baseline backup.
SHA-256: `1123e8a3c69859992138ff49228315a4ef38114af7ab7231d564c28fa4da45b4`.
Earlier `publication-c1e7679.zip` and `initial-preview-crlf/` are superseded Windows newline-converted working artifacts; do not use them for deployment or rollback.

## Local reproduction

From a fresh checkout with no `public/` directory:

    python -m unittest discover -s scripts -p 'test_*.py'
    python scripts/build_publication.py
    python -m http.server 8765 --directory public --bind 127.0.0.1

Open `/projects/`. Generated reports are local engineering evidence and are not copied to public output.

`git diff --check` reports whitespace already present in preserved original files. It was intentionally not normalized because byte preservation takes precedence.

LIFE, rail and Fund are explicitly marked pending migration; no VPS migration or shutdown has been performed. The canceled World and Me is labeled a retained entry awaiting repurposing, not an active accomplishment.
