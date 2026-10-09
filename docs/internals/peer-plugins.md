# Peer plugins

Peer is a small core and a set of optional plugins. Every plugin is compiled in and listed once per
surface. An environment's owner turns each one on or off, and a plugin that is off, or that needs a
Hub feature the signed-in Hub does not serve, contributes nothing: no text for agents, no `peer`
command, no request effect, no UI. This page holds the rules that keep plugins separable. For the
shapes, read [the plugin definition](../../apps/server/src/peerHub/core/plugin.ts) and the plugins
in [`plugins/`](../../apps/server/src/peerHub/plugins).

## Core or plugin

Core is what coordination cannot work without: the environment's state and Hub session, workspaces
and checkouts, the work report, the status stream, adapter installation, and the broker with the
five primitives (session, claim, versioned context, declared read, shared message). Overlaps,
contexts and the index carry the guarantees agents rely on, such as an explicit fallback for every
verdict, so they cannot be turned off and the broker runs them before any plugin.

A feature is a plugin when coordination keeps working without it. Extend core instead when:

- an edit must be decided through the Hub. Plugin verdicts share a 1,000 ms budget and must be
  local or cached; a check that needs the Hub per edit belongs in core's intent.
- other features would have to import it. Plugins never import each other.
- every agent must get it, whatever the environment's owner chose.

Plugins that need each other's work meet in capability slots: a runtime that runs agents, a git
host, an index source, the task launcher, the request acceptor. At most one active plugin fills
each, and core works without it. `PeerPlugins.require(slot)` returns the plugin that fills a slot,
or fails saying that plugin is off or needs a newer Hub, so core can tell people why a capability is
missing. Starting an agent from a team request goes through the request acceptor this way.

## Where a plugin lives

| Surface        | Folder                                               | Listed in                                  |
| -------------- | ---------------------------------------------------- | ------------------------------------------ |
| Server         | `apps/server/src/peerHub/plugins/<id>/`              | `peerPlugins()` in `core/registry.ts`      |
| Contracts      | `packages/contracts/src/peer/<id>.ts`, `<id>.rpc.ts` | `peer/rpcRegistry.ts`, `peer/registry.ts`  |
| Client runtime | `packages/client-runtime/src/peer/<id>.ts`           | its `./peer/<id>` export in `package.json` |
| Web            | `apps/web/src/components/workspaces/<id>/`           | `PEER_WEB_PLUGINS` in `slots.ts`           |
| Mobile         | `apps/mobile/src/features/peer/<id>/`                | `PEER_MOBILE_PLUGINS` in `slots.ts`        |
| Hub            | `server/src/features/<id>/` in the Hub repository    | `features::all()`                          |

The id is the same on every surface, and so is the order: `PEER_PLUGIN_IDS` in
[`peer/plugin.ts`](../../packages/contracts/src/peer/plugin.ts) fixes the order of plugins' text for
agents and of their UI. A server plugin's folder holds `index.ts` (its definition), a service module
named after it, `hub.ts` for its Hub endpoints, `client/` for an external tool's protocol, and its
tests.

## The definition

A plugin is `bindPlugin({ id, title, summary, defaultEnabled, hubFeature, layer, make })`. `layer`
builds the plugin's own services whatever its state; `make` binds its transports to them. Core reads
which plugins are active once per hook, command and request and skips the others entirely, so a
contribution never checks whether its plugin is on.

- **Services first.** What a plugin can do is a method of its service, as
  [Effect services](./effect-services.md) describes. Its commands, RPC handlers, hooks and Hub
  listeners decode, call that method and map errors: `peer request` and `peerHub.sendRequest` call
  the same `Requests.send`.
- **Verdicts only tighten.** A plugin's verdict on a tool call may deny or ask, never allow, and has
  no side effects, since core may discard it. Its fallback applies when it misses the budget. Letting
  Peer's own files through is `ownPaths`.
- **Text is bounded and comes after core's.** A plugin's start block is cut at 2,000 characters and
  its text for one step at 1,200, ending with the command that shows the rest. Text not ready by the
  hook's deadline reaches the agent at its next step. Only notices the agent must answer may wake an
  idle agent. Text a teammate wrote goes through the fences in
  [`peerText.ts`](../../apps/server/src/peerHub/peerText.ts).
- **Background work runs in `run`.** Core forks it while the plugin is active and interrupts it when
  the plugin stops, whether its owner turned it off or the Hub stopped serving its feature. Stop what
  the plugin started from finalizers there: observe stops sending views, GitHub ends a sign-in still
  waiting for its code.
- **`turnOff` undoes what the plugin set up outside Peer**, once, when the owner turns it off. It runs
  under the state lock, so it must not take the lock, and may call what expects it held, such as
  `PeerWork.refresh`. A failure shows as the plugin's error in the status, and the choice stands.
  Turning the plugin on again must not bring those effects back: shared capacity's revoked keys stay
  revoked, and observe's threads stay unshared.
- **Hub pings.** A listener names the pings it follows. `resync` reaches every listener, and so does
  connecting to a workspace's event stream, because pings sent while not connected were missed. A
  listener that mirrors durable state, like the request inbox, reads it again then. Listeners run
  inline with the event stream, so they queue their reads rather than wait on the Hub.

## The core API

Plugins reach core only through `core/plugin.ts` and the services that `PeerCore` lists in
`core/<area>/Peer*.ts`: `PeerState` (places, the lock, a plugin's own `pluginData`), `PeerHubClient`
(`request` and `stream` on the session), `PeerPlugins`, `PeerStatus` (`publish`), `PeerWork` (the
work report, a thread's `view`, its task), `PeerAgents` (the agent sessions coordination knows) and
`PeerIndex` (the works an agent chooses its context from, and the entries the index source adds);
sessions and works are known only while coordination is on. `PeerCore` also carries T3's provider
settings, where shared capacity adds its provider instances. A plugin's Hub endpoints live in its
own `hub.ts`; [`hubApi.ts`](../../apps/server/src/peerHub/core/hub/hubApi.ts) keeps only core's.

`peerPlugins()` is a function, read when core starts: plugins import core's services, which import
the registry, so the list cannot be built while modules load. For the same reason, a plugin's
module-level code uses nothing of core's.

The broker keeps its Promise-based internals and runs plugins' Effects with the runtime it captured
when it started ([`core/broker/host.ts`](../../apps/server/src/peerHub/core/broker/host.ts)).

## Contracts and compatibility

Apps, Hubs and clients of different ages work together, so names on the wire never change.

- A plugin's schemas go in `peer/<id>.ts`, and its methods and their scopes in `peer/<id>.rpc.ts`,
  which `rpcRegistry.ts` merges into `PeerRpcGroup`, `PEER_RPC_SCOPES` and `PEER_STREAM_METHODS`. The
  split keeps imports acyclic: schema files import only `peer/base.ts`, while RPC files may import
  `peerHub.ts` for `PeerHubStatus`. `peerHub.ts` and the package index still export every moved name.
- Methods that existed before plugins keep `peerHub.<name>`. A new plugin names its methods
  `peer.<id>.<name>`.
- Status fields that existed before plugins keep their places and shapes, frozen in
  [`core/status/legacy.ts`](../../apps/server/src/peerHub/core/status/legacy.ts) with a neutral value
  for while their plugin is inactive. A new plugin gets an optional field of its own instead
  (`peer/registry.ts`), omitted while it is inactive. Slices are read on every publish, so they hold
  counts and ids; detail goes behind the plugin's own requests.
- A plugin keeps its data in its `pluginData` slice of `peer-hub.json`. Features that existed before
  plugins keep their old fields there (`sharedThreads`, `sharedInstances`), so older files load as
  they are.
- `PeerPluginState`'s `id` and `reason` are plain strings, so a client reads the status of a newer
  environment. A status without a plugin list means the features that existed before plugins are
  active ([`activePlugin`](../../packages/client-runtime/src/peer/plugins.ts)).

## Slots

Clients compose plugins through slots. Core views ask the active plugins for their part (Work panel
sections, Needs you items, project and task actions, thread menus, Settings rows, palette actions)
and render nothing for the others. The slot types are in
[`slots.types.ts`](../../apps/web/src/components/workspaces/slots.types.ts) on web and
[`slotTypes.ts`](../../apps/mobile/src/features/peer/slotTypes.ts) on mobile. The list of active
plugins changes only when a plugin turns on or off, and row slots take their data from props, never
from a subscription per row. Routes stay in `apps/web/src/routes`, since routing is file-based; a
page of an inactive plugin renders `PluginOff`. A UI capability one plugin gives another is a slot
too: requests' "Accept & start" renders herdr's `taskLauncher`, and offers only Dismiss without one.

## Hub features

On the Hub, a plugin's server side is a module in `server/src/features/<id>/` behind the `Feature`
trait of `server/src/features/mod.rs`, listed in `features::all()`. A feature mounts routes below
`/v1/workspaces/{slug}`, declares the pings it publishes, follows coordination reports and adds
counts to the coordination view. The Hub lists the features it serves, with their revisions, in
`/health` and `/v1/me`. An app plugin is active only while its `hubFeature` is listed at its revision
or a later one. A Hub from before the catalog serves `requests`, `observe`, `knowledge` and `memory`
at revision 1, and while the Hub cannot be reached the last catalog read stands.

A feature that stores data owns a KV domain with its own append-only migration ledger
(`features::DOMAINS`) and never appends to another domain's ledger. A Hub build refuses a ledger
newer than its own, so a feature's ledger never blocks rolling back to a build from before the
feature. Keys that existed before a feature stay where they are and are adopted by its first
manifest, which also names any write it must make together with another domain's keys.

## Turning things off

- **A plugin, on one environment.** Its owner turns it off in Settings → Workspaces → Peer plugins on
  web and desktop, or in Peer workspaces on mobile, through `peerHub.setPlugin`, which needs
  access-write. The choice persists in `peer-hub.json` and applies from the next hook, command and
  request.
- **While a plugin is inactive**, its commands answer `peer: <name> is turned off on this
environment.` or `peer: <name> needs a newer Peer Hub.` and are left out of `peer help`; its RPC
  methods fail with the same reason before anything runs; its hooks, listeners, slots and capability
  slots are skipped, and core's own texts for agents stop naming its commands (`CommandsOn`). T3
  registers MCP toolkits once, when the server starts, so a plugin's tools stay listed and must
  refuse calls themselves (`PeerPlugins.requireActive`).
- **A feature, on one Hub.** Its operator sets `PEERHUB_FEATURES_OFF` (NixOS:
  `services.peerhub.featuresOff`) and restarts the Hub. The feature's routes answer 404 and its data
  stays; app plugins that need it say the Hub must be updated.

## Tests and budgets

Test a plugin through core. [`core/testkit.ts`](../../apps/server/src/peerHub/core/testkit.ts) builds
core's real services on a temporary state directory, with a stand-in Hub whose event streams a test
can hold open and `push` pings down. [`core/broker/testkit.ts`](../../apps/server/src/peerHub/core/broker/testkit.ts)
runs the broker for `peer` commands, with `pluginsOf` giving it the real plugins. Tests never touch
`~/.t3`, `~/.peer` or `~/.claude`. An external tool is a seam with its real implementation as the
default: GitHub CLI is the `GitHubCli` reference, so a test gives a stand-in instead of whatever `gh`
the machine has. Each plugin's tests cover the plugin turned off, not only on.

Each non-test file under `core/` stays within about 800 lines, and each plugin folder within about
1,000 non-test lines, not counting `client/`, whose files stay within 800. On the Hub,
`server/src/features/tests.rs` holds each feature folder to 1,000 lines. Peer Memory is exempt until
it is extracted, and its ceiling only shrinks.

## Adding a plugin

1. Add its id to `PEER_PLUGIN_IDS`, in registry order.
2. Contracts: `peer/<id>.ts`, and `peer/<id>.rpc.ts` with `peer.<id>.<name>` methods and their
   scopes, one line each in `rpcRegistry.ts`; its status field in `peer/registry.ts`, if it has one.
3. Server: `plugins/<id>/` with its service, `index.ts`, `hub.ts` and tests, and one line in
   `peerPlugins()`.
4. Hub, if it needs one: `server/src/features/<id>/` with its own domain, one line in
   `features::all()` and in `DOMAINS`, and the plugin's `hubFeature` naming it.
5. Clients: its atoms in `packages/client-runtime/src/peer/<id>.ts` with their export, its web and
   mobile folders, and one line in each slot registry.
6. Providers: Claude Code and Codex get its hook text. Other providers have no Peer hooks, so their
   agents get none; an MCP tool is how to reach them.
7. Test it on and off. Document it for users only where people need to know how to use it.
