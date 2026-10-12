Captured from the installed CodeGraph 0.50.3 in two throwaway TypeScript projects (2026-10-12).
Absolute temporary paths are replaced by `${ROOT}` and the socket path by `${SOCKET}`.
`ready.json` is `codegraph status --json` of a complete index (`extractionStatus` is `current`);
`no-index.json` is the same call in a folder nobody initialized; `corrupt.json` is the recording
of an index that belongs to another location, taken from the impact plugin's own set.
`node-invoice.json`, `node-money.json` and `node-missing.json` are `codegraph node <path> -p <root>
--symbols-only --json`: the symbols of a file are listed flat and unqualified (a method is not
written with its class), and a file the index does not hold answers without an error, in words.
The reader never runs `init`, `index` or `sync`; the two throwaway indexes were removed with their folders.
