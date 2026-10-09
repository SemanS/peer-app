Captured from the installed CodeGraph 0.50.3 in two throwaway TypeScript projects (2026-10-09).
`extractionStatus` of a complete index is `current`. Absolute temporary paths are replaced by placeholders.
The binary's node JSON wraps a Markdown map; exact ranges come from structured search nodes matched by name/path/start.
`pending.json` records the observed status response after editing, whose legacy binary exposes only counts and did not detect this edit. The adapter fails closed when exact pending paths are unavailable and counts are nonzero. Tests also cover newer structured pending-path responses separately.
No index was created in an application or Hub checkout. The transient indexes were removed with their temporary projects.
