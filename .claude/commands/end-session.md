---
description: Close a ShelfReady build session and write the log
---

Close this build session.

1. Create `docs/sessions/NN-short-slug.md` from `docs/sessions/_template.md`, where NN is the next episode number. Fill it in from what we actually did this session (check `git log` and `git diff` since the last session log).
2. Add any real tradeoffs we made to `docs/DECISIONS.md` as dated entries.
3. Update the "Current status" block in `CLAUDE.md` (phase, last session, next target, blockers). Keep it to 5 lines.
4. Print a 3-line close-out I can read on camera: what works now, what's still rough, and the next target.
5. Suggest a commit message. Do not commit until I confirm.
