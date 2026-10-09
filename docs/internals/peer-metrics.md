# Peer metrics

The [event catalog](../../apps/server/src/peerHub/core/metricsCatalog.ts) is the boundary: the queued writer projects every record again before writing or notifying listeners. Ordinary coordination logs carry counts, sizes, timings, short protocol identifiers and opaque task references. Unknown events retain only their name and time; unknown fields are dropped. Protocol detail never enters the normal log, including while the metrics plugin is off.

The separate debug log is local and opt-in. Settings limits it to 24 hours; `PEER_COORDINATION_DEBUG=1` forces it for labs. Re-enabling debug replaces the file; restoring its deadline after restart keeps it. Never upload debug detail as metrics. A one-time streaming scrub replaces legacy logs and their rotated copy, drops invalid lines and keeps no original. A v2 header prevents repeated rewrites.

Add an event to the catalog before recording it. Put counts in `*Count`, tallies in `*Counts`, and error classes in `*Class`; preserve the original names only in debug detail. Task ids and `task:` scopes use the `task` kind, since untracked task ids contain their titles. Clients join `taskRef` to their work view. An `id` is a protocol token, never a title, email, path or knowledge-entry slug. The static guard and hostile-value tests protect this boundary.

The broker bridge converts legacy detail fields into separate metric fields and stamps a session's workspace, project and adapter. `stampOf` uses the Mod handshake, not a time-sensitive coordination label. An `intent.failed` is diagnostic; only the subsequent `intent.unverified` with `wentOn` counts an edit without a verdict. Counting both would overstate failures.
