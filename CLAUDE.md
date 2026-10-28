# Notes for Claude

- The frontent is a pnpm project. use pnpm.

- Sessions may run in "don't ask" mode: a Bash command that doesn't match an
  allow rule in `.claude/settings.json` is refused, not prompted. Every part of
  a compound command (`;`, `&&`, `|`) must match on its own. So:
  - run the UI through its scripts from the repo root: `pnpm -C ui run test`,
    `pnpm -C ui check`, `pnpm -C ui build` — never `pnpm --dir`, `pnpm exec`,
    `npx` or a bare `vitest`
  - one plain command per call: no `cd …;` prefix, no `2>/dev/null`, no
    `2>&1 | tail`; use `git -C <dir>` rather than `cd`
  - to look inside the sibling repos (amp-cef, amp-mgui, sobamail), use the
    Read tool or an Explore agent, not shell `grep` over them

- assets is the live dir maintained by the pnpm run dev-watch, ignore it

- Mutator.mjs and all that it imports comprise the Sobamail application backend.
  It doesn't support package managers like npm/pnpm.

- you MUST record durable facts, findings and lessons learnt in repo documents
  (e.g. `zai/messagemodel-invariants.md` — the facts document for the message
  model), not in assistant-local memory

- Always commit to whatever branch the current repo is, even when it's main/master.
  Trust that the owner must have set up the right branch to work on.

- In a long running task, proceed by committing any meaningful chunk of work,
  together with its tests if applicable, as you progress through it. Commits
  must not span multiple concerns
