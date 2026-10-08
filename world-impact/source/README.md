# 世界與我 — first usable edition

Static application, additive deployment at https://shrimp-guard.us.ci/world-impact/.

## Content and privacy

`../events.json` is the editable source of three editorial cases, snapshot 2026-10-08 Asia/Taipei. Primary source facts, conditional inference, unknowns and individual conditions are separate. No personal match is assumed. All required conditions must be Yes to display a possible relationship; any No displays no direct relationship; unknown remains pending. A relationship is not proof of impact.

Cloudflare is resolved/historical. Belgium switches to historical after 2026-10-13 00:00 Europe/Brussels. The Maersk item is explicitly a dated advisory snapshot requiring a fresh official check, not a live status. No financial forecasting or personal holdings. localStorage key `world-and-me-v1` stores only optional categories, tri-state answers and checklists. No analytics, accounts, backend or submitted personal data.

## Real Blender production

`build_scene.py` builds the authored scene with Blender Python; `world.blend` is its actual output. `../assets/world.glb` is exported from Blender with mesh modifiers applied. `../assets/world.png` is the Cycles 32-sample render; `world.webp` is its mobile-optimized image. Three.js only displays the Blender GLB; it does not substitute procedural web geometry for Blender authorship.

Reproduce with Blender 4.5.3 LTS:

```text
blender --background --python build_scene.py
python -c "from PIL import Image; Image.open('../assets/world.png').save('../assets/world.webp',quality=86,method=6)"
```

Official Blender Windows ZIP SHA-256: `6b657c8bdd3a7b65b07b9e1ae17eb4be7dd4aa23121da7f3d3354fc2551330a7`. Verified against Blender's official 4.5.3 SHA-256 manifest. Blender binary itself is not committed.

The supplied Library concept `libfile_8cacb37771b08191b00cf31beb7ceeee` could not be inspected locally: two freshly prepared official helper downloads returned HTTP 403. No guessed URL or permission bypass was used. This edition uses an independently authored Blender interpretation of the written brief and does not claim reference-image fidelity.

## Run and verify

Serve the parent repository with any static server, e.g. `python -m http.server 8765 --directory <checkout>`; open `/world-impact/`. No build needed. Browser dependencies are vendored locally under assets (Three.js 0.186.1, MIT license retained). Rendering is on demand only: load/resize/drag, no continuous animation. Default is the 62 KB static image. Optional GLB is about 1.59 MB; loader/runtime add about 2.3 MB uncompressed. Device pixel ratio capped at 1.5. Reduced-motion and unsupported WebGL keep the complete interactive HTML experience.

`qa.cjs`, `final-check.cjs`, `perf.cjs` use Playwright with the local Chrome executable; adjust that path on other hosts. Install the provided locked dependencies in an isolated tooling directory. Tests expect the static server at localhost:8765. Run from a directory with an `evidence/` subdirectory. QA report, Blender execution log and mobile/desktop screenshots accompany this source.

Tested: three cases, repeated open/back/close, Escape, browser Back, internal evidence jumps, tri-state matches/no-match, save/reload, checklist restoration, cancel, preference persistence, clear cancellation/confirmation, empty category, data failure/retry, reduced motion, WebGL fallback, actual GLB loading/disposal, Belgium expiry, 390px overflow, throttled mobile emulation.

Not tested: physical iOS/Android devices, Safari/Firefox, screen-reader assistive technology, long-term source changes. No claim of real-time monitoring or exact financial impact.

## Deployment and rollback

Base publishing commit: `b1b6bd5cf5f4a73f9494e844ac3ab68ca992fa0c` on `gh-pages`. Only `world-impact/` is added. Existing `room/`, `taipei-mrt/`, CNAME and all other blobs are preserved. Do not push main: its two Hugo workflows can overwrite the publishing branch/site. No workflow, security, billing, domain or VPS configuration is changed.

Rollback by reverting the dedicated world-impact deployment commit on the latest gh-pages branch, then pushing that branch normally. Do not reset/force-push the entire branch or revert unrelated later commits. Verify the revert changes only `world-impact/` and wait for Pages deployment success. Long-term preservation during future main/Hugo publishes needs a separately reviewed workflow/source integration; that change is outside this safe additive release.
