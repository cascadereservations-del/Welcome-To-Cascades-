# Guest guide v9 (release candidate)

Single-file guide, built and reviewed in the 2026-11-25 mobile session (preview round r24).
It replaces the missing `guide-v9.bundle` / branch `v8/redesign` (f3bf928), which was never found on the PC, in Drive or on GitHub.

- `index.html`: the full v9 guide. It still runs in preview mode (`const PREVIEW=true`, mock RPCs, `WXSNAP` weather snapshot). Flip and clean up before release (see the handoff prompt).
- `img/`: every image the guide uses (73 files).
- `backend/`: phase 1 and phase 2 SQL (tested on local Postgres 16, not run on Supabase), plus the backend README and the glass/icon patch script for reference.

Live v7.10.8 at the repo root `index.html` is untouched on this branch. Promotion (v9 becoming the root `index.html`) is a separate, approved step.
