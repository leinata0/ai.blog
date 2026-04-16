# Repo Maintenance

## Worktree housekeeping

- Keep the primary workspace on `master` only.
- Remove old `.worktrees/*` folders after their changes are merged or no longer needed.
- Prune `.claude/worktrees/*` entries marked `prunable`.
- Clear rebuildable caches such as `.uv-cache` during periodic cleanup.

## Local size expectations

- `frontend/node_modules` and `backend/.venv` are dependency footprints and are expected.
- Large repo growth should first be checked against `.worktrees`, then local caches.
