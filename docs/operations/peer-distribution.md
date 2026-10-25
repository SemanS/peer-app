# Distributing Peer Local

The app repository is the source distribution for Peer Local: desktop, web and mobile clients, the
local server and CLI, agent hooks, Git/Jujutsu adapters, local coordination, and the public Hub client
and wire contracts. Keep the upstream MIT license and attribution intact.

The separate Peer Hub repository is private. Its service implementation, organization and entitlement
policy, advanced cross-person coordination, ownership decisions, planning, knowledge ranking,
shared memory and Slack orchestration are not app build inputs. Public contracts describe requests
and observable answers, not those implementations. Copying an open client is permitted; protecting
commercial implementation means keeping it server-side, not obfuscating a client or hiding a protocol.

Run `pnpm release:local:check` before preparing a source release. The server bundle also runs this
check. It rejects private Hub source roots, operator deployment/configuration, company workspace data
and the private repository marker. The check is an input boundary, not a secret-history audit. Review
the app's Git history and third-party notices before changing repository visibility; never publish the
parent Hub repository or its history as a client release.

Local coordination must remain useful with no Hub, credentials or network. Keep commercial admission
rules and entitlement decisions out of client code. A locally editable UI value must never grant a
Hub entitlement; clients display the Hub's read-only edition response.
