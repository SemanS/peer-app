# Peer metrics

The [event catalog](../../apps/server/src/peerHub/core/metricsCatalog.ts) is the boundary: the queued writer projects every record before writing or notifying listeners. Ordinary coordination logs carry counts, sizes, timings, short protocol identifiers and opaque task references. Unknown events retain only their name and time; unknown fields are dropped.

Debug detail stays local and opt-in. Settings limits it to 24 hours; `PEER_COORDINATION_DEBUG=1` forces it for labs. Re-enabling replaces the file; restoring the deadline after restart keeps it. Never upload debug detail. A streaming scrub replaces legacy logs and their rotated copy once, drops invalid lines and leaves no original. A v2 header prevents repeated rewrites.

Add events to the catalog before recording them. Counts use `*Count`, tallies `*Counts`, and failures `*Class`; original text belongs only in debug detail. Untracked task ids can be titles, so task ids and `task:` scopes use the `task` kind. Clients join `taskRef` to the work view. Protocol identifiers must never contain emails, paths or knowledge-entry slugs.

The broker bridge separates metric fields from detail and stamps workspace, project and adapter. Adapter identity comes from the durable Mod handshake. `intent.failed` is diagnostic: only `intent.unverified` with `wentOn` counts an edit that proceeded without a verdict. Counting both would overstate failures; a late Hub answer may still count that edit twice.
