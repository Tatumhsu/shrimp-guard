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
- UI VERIFIED using installed desktop Chrome and the existing Playwright package: 26 checks passed at 1440x1000 and 390x844. Verified six entries, nine links, responsive columns, no horizontal overflow, migration/paused labels, room and retained world loading, browser back, reload, original homepage articles, homepage navigation and no JavaScript exceptions. Both full-page screenshots were visually inspected. Physical phones, Safari and Firefox were not tested.

## Safe continuation / deployment gates

1. Review this local branch, all-file hash report, and completed desktop/mobile screenshot evidence.
2. Existing Git credential helper authenticated a read-only Pages API request successfully: status built, build_type legacy, source gh-pages at /, cname shrimp-guard.us.ci. See verification/pages-settings.json. No credential was displayed or created. No configuration permission blocker remains; do not change Pages mode or permissions.
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

## Why preserve the entire tree and prevent future drift

Main lacks not only room/world-impact but also published article/taxonomy and legacy paths. Copying only the two apps would still erase unrelated existing URLs. The full published Git tree is therefore the canonical baseline; output is derived only from that baseline plus the explicitly reviewed overlay. Hugo cannot silently regenerate this output. SHA-256 validation rejects baseline corruption and the output allowlist rejects unreviewed added, changed or deleted paths.

CI now also runs a read-only remote-head gate: gh-pages must still equal the recorded baseline commit. If another publisher advances it, the build fails and requires deliberate reconciliation. The local release command now prepares the output and matching baseline-promotion commit together. It applies promotion only after the matching successful Pages build and live hashes; EXPECTED is read from verification/source-state.json, never edited separately. Repeating the same command resumes rather than republishing. This is a controlled publication source, not a claim that legacy Hugo content has been fully reconstructed. The original Markdown and templates remain available for a separately reviewed source migration.

## Exact workflow delta

- Removed deploy.yml: main push/manual trigger, Hugo build, upload-pages-artifact and deploy-pages artifact deployment, with pages/id-token write permissions. This was the competing artifact route.
- Removed hugo.yml: main push, Hugo build, peaceiris/actions-gh-pages overwrite of the publication branch. Its incomplete public output could erase published additions.
- Added publication.yml: main/safety-branch push, PR and manual validation; explicit contents: read; Python unit tests, remote-head freshness guard, full-baseline SHA-256 and output allowlist checks. The artifact contains only public/. No deployment step, repository settings change, or permission expansion.
- Future reviewed deployment must use the confirmed existing gh-pages branch mode and this same verified full output. The artifact-deploy route must stay disabled. A publishing job is deliberately not activated in this review phase.

Library screenshot save attempted using the current official prepared-upload helper but failed before upload with `Library prepare_uploads is not available`. No Library IDs were issued. The verified screenshots remain in verification/screenshots/. No alternative write route or fabricated IDs were used.


## Independent review fixes and reproducible local release

The website output and approved UI are unchanged. Browser QA now uses PLAYWRIGHT_MODULE (default package name playwright) and optional BROWSER_EXECUTABLE (default installed Playwright browser); no personal absolute path is committed. Direct `python scripts/test_publication.py` now runs all five tests. Seven additional release tests cover remote advance, retry phases, no duplicate push, failed build preventing promotion, completed retry, queued legacy workflow blocking, and real Git tree/promotion/rollback objects.

All commands run from this repo. Do not execute the write commands before approval. The prepared plan and artifact live under ignored .release/; retaining that plan makes retries deterministic. Do not regenerate a plan merely because a push response was uncertain.

Preparation (read-only remote operations; creates only local Git objects and local artifact):

    python scripts/release.py prepare --expected-main 1cd0b3116fc3890ca790c0ce7ad49f9132a7aa3b
    python scripts/release.py release

The prepare command checks a clean reviewed checkout, both exact remote SHAs, existing legacy Pages mode/domain, no queued/in-progress/waiting/pending/requested nonvalidation workflows, no ongoing Pages build, remote publication bytes against manifest, all tests, complete artifact hash/allowlist, then creates an ordinary gh-pages child commit and its corresponding source promotion commit. It rechecks both heads at the end. Nothing is pushed by prepare or the default release command.

After explicit publication approval, one resumable command performs the release:

    python scripts/release.py release --execute

It uses normal FF pushes with the existing user's Git login (not GITHUB_TOKEN): first reviewed source to main to retire both competing workflows, rechecks remote heads/active jobs, then only the public artifact tree to gh-pages. It does not cancel any run or change Pages settings. If Pages is still building, failed, or live caches have not converged, it stops without promotion; retry the SAME command and SAME plan. Already-pushed commits are recognized from remote refs, so retries do not create or republish another commit. When the exact publication SHA has a successful Pages build and the live checks match, it FF-pushes the already-prepared source promotion to main. That commit adopts all published bytes under publication/, removes consumed overlays, resets the allowlist, and updates manifest/result/source-state together. Local adoption is the printed `git merge --ff-only <promotion>` command.

If a remote head moved outside these planned states, the command stops without force-push. A push rejection or permission/API error stops the flow. If normal user push does not trigger the matching legacy Pages build, no baseline is promoted and no alternative token or setting is introduced. During the short publication-to-promotion interval, the older source validation can deliberately fail its freshness gate; the final promotion validation uses the new exact baseline. This is fail-closed, not an alternate publisher.

Rollback after adopting the completed source promotion:

    python scripts/release.py prepare --expected-main <verified-current-main> --rollback-plan .release/plan.json --plan .release/rollback.json
    python scripts/release.py release --plan .release/rollback.json
    # Only after rollback approval:
    python scripts/release.py release --plan .release/rollback.json --execute

Rollback verifies the original backup hashes, creates a NEW ordinary commit whose parent is the current gh-pages head, and restores only that verified publication tree. The matching promotion preserves the current validation/release workflows; it never restores old deployment workflows. The same build/live verification and retry rules apply. For an interrupted or failed deployment before promotion, rollback preparation also accepts the original plan's exact published state: main must equal that source commit, gh-pages must equal the prepared publication commit, and all current publication hashes must equal the original artifact. This permits rollback without falsely declaring the failed build successful. Any unrelated remote advance still stops it.

The release process intentionally runs locally because a workflow GITHUB_TOKEN branch push is not assumed to trigger legacy Pages builds. It needs only existing authorized Git push and read-only API access; no new credential or repository permission is requested.
