# Peer Core

Peer Core runs Peer's coordination without the desktop app, inside the `t3` server binary as
`peer core …` ([`cli/peerCore.ts`](../../apps/server/src/cli/peerCore.ts),
[`peerHub/headless/`](../../apps/server/src/peerHub/headless)). It runs the same core and plugins
as the app; what differs is who owns the broker and which T3 services stand behind `PeerCore`.
`peer core X` is `t3 peer X`: the `peer` shim execs its embedded launch command with `peer X`
and never touches the socket for `core`, and the npm package's `peer` bin rewrites its argv the same
way in [`bin.ts`](../../apps/server/src/bin.ts) (any other `peer <cmd>` it forwards through the
socket, as the shim does). `t3 peer-core` stays as an alias because shims written before the rename
autostart with `peer-core serve --detach`.

The npm package is `@webinson/peer-core` (an unscoped `peer-core` 0.1.855 predates it), built by [`scripts/build-npm-peer.ts`](../../scripts/build-npm-peer.ts):
`apps/server/dist` without source maps plus the packages the bundle leaves external
([`scripts/lib/cli-external-packages.ts`](../../scripts/lib/cli-external-packages.ts)) as exact
dependencies, so npm installs their native builds. It is not upstream's `t3` package, which is a
launcher that downloads a single-executable archive from a GitHub Release; Peer publishes no such
archive. `npm publish release/npm/webinson-peer-core-<version>.tgz` is a deliberate, separate step.

## One broker per environment

The Hub keys live sessions, threads, claims and presence by (workspace, email, environment) and
replaces them on every `PUT /coord` and `PUT /threads`; pings from the own environment are dropped
as echo. Two brokers with the same environment id would erase each other's reports every few
seconds. They share the state dir, the Hub token and `<stateDir>/environment-id`, so exactly one may
coordinate at a time. `peer-hub.json` is also read once at startup and kept in memory
([`PeerState.ts`](../../apps/server/src/peerHub/core/state/PeerState.ts)): a second process holding
it would overwrite the first one's writes. One-shot commands (`login`, `join`, `logout`, `share`,
`bind`, `connect`, `hooks`) therefore refuse or forward through the socket while any broker is live;
`tasks` and `take` only talk to the Hub and write nothing then.

The broker had no lock: start unlinks and rebinds the socket. The exclusion is the owner record
`<stateDir>/coord/owner.json` (`{ kind, pid, startedAt }`), written on bind and removed on stop, and
the socket's `GET /owner` that proves the owner is alive
([`core/broker/owner.ts`](../../apps/server/src/peerHub/core/broker/owner.ts)). The app's broker,
finding a live `peer-core` owner, calls `POST /owner/handover`; the socket's 0600 mode is the
authorization. The stopping owner reports `[]` to the Hub, removes the record and the socket, and
only then does the new owner bind. Peer Core finding any live owner exits instead. A dead owner (pid
gone) is replaced. Agents see a handover as a Peer restart and re-register at their next call.

Peer Core never takes T3's server lock (`server-owner.sqlite`) and never opens `statev2.sqlite`. It
is not a T3 server; if it held the lock, the app could not start while it runs.

## Headless services

`PeerCore` includes app services. Headless they are stand-ins:

- projects: `<stateDir>/peer-core-projects.json`, filled by `peer core share`;
- thread projections: empty for every thread;
- server settings: `<stateDir>/settings.json` read with the app's schema and defaults, writes
  refused (shared capacity cannot add provider instances);
- awareness relay and provider continuations: no-ops;
- the local usage engine: none. It is no part of `PeerCore`; the `usage` plugin reads it through
  [`UsageSessionReader`](../../apps/server/src/usage/usageSessionTotals.ts), null here, and then
  runs no reporter.

So headless there are no app threads, no Codex or native wake queues, no provider instances and no
herdr runtime. Plugins build on `PeerCore` only and construct on these stand-ins; one that fails to
build is skipped with "needs the Peer app" in the runtime
([`headless/PeerCoreRuntime.ts`](../../apps/server/src/peerHub/headless/PeerCoreRuntime.ts)), never
in core. Because the work report holds no threads, the Hub shows the app's earlier threads of this
environment as unavailable until the app runs again.

## Autostart

The `peer` shim and the hook embed the launch command of the broker that wrote them
([`core/adapters/cliScript.ts`](../../apps/server/src/peerHub/core/adapters/cliScript.ts),
[`core/adapters/scripts.ts`](../../apps/server/src/peerHub/core/adapters/scripts.ts)). In `mcp`
mode, when no socket answers, the shim runs `<launch> peer serve --detach` and waits for the
socket. The hook starts it only on `SessionStart` when nothing listens (curl's exit 7), in the
background, and never waits: Claude Code and Codex must not wait on a daemon inside a hook, so that
first event goes unanswered and the session's next events reach Peer Core. Peer Core refuses to
start beside a live owner, so sessions starting at once start one broker.

## Binding a clone by its remote

A person who joins from an invitation clones the project's repository wherever they like, so
`PeerState.placeOf` ([`PeerState.ts`](../../apps/server/src/peerHub/core/state/PeerState.ts)) falls
back, after the path rules, to the repository's `origin` (a Jujutsu workspace's main repository's
Git remote), compared across URL forms by
[`remotes.ts`](../../apps/server/src/peerHub/core/state/remotes.ts). Only an unambiguous match binds: one
project's repository, which has no checkout on this computer yet. The binding is a
`localCheckouts` entry, written as `peer core bind` writes it, so the app and Peer Core read it
the same way. Several matches, or an existing checkout, bind nothing; a wrong binding would put an
agent's work on another project's coordination, which is worse than asking.

The binding is said once: `placeOf` leaves a one-line notice that `pendingBindingNotice()` hands to
the next hook or `peer mcp` output and clears. Each folder's lookup and notice happen once per
process, and its remote is read once per process, because hooks call `placeOf` on every event.
A one-shot command that is not the broker (`peer core status`, `tasks`, `take`) passes
`bindByRemote: false` while a broker runs: the broker keeps `peer-hub.json` in memory and would
overwrite the binding with its next write.
