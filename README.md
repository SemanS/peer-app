# Peer Local

Peer is a workspace for coding agents. Run providers, review their changes and coordinate agents
working in the same repository from desktop, web or mobile.

Peer Local is free and open source. It works without a Peer Hub account. Your providers' account
and usage terms still apply. Connect an optional Hub to share tasks, coordination and knowledge
with teammates. The hosted Hub is free for two people with unlimited interactions; larger teams
need Team capacity.

- [Download Peer](https://github.com/SemanS/peer-app/releases), then install and sign in to a supported provider.
- [Set up local coordination](docs/user/peer-local.md) and agent hooks.
- [Configure Peer](docs/user/peer-settings.md), including an optional team Hub.

This repository contains the clients, local server, CLI, hooks and public Hub protocol. The Hub
service lives in a separate private repository. You can build and use Local without its source.
See [Distributing Peer Local](docs/operations/peer-distribution.md) for the boundary.

## Providers

Peer runs providers on the connected computer. Install and authenticate the providers you want to use:

| Provider    | Setup                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude Code | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                        |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Enable it in Settings, choose **Install Antigravity**, then **Sign in with Google**.         |

Local edit coordination has hooks for Claude Code and Codex. Other providers' coordination support
depends on their MCP adapter. See [Peer Local](docs/user/peer-local.md) for the limits.

## Build from source

Use Node 24 and Vite+. These commands build and run this Peer fork. The upstream T3 Code installers
and package-manager entries install T3 Code.

### Install `vp`

On macOS or Linux:

```sh
curl -fsSL https://vite.plus | bash
```

On Windows, in PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

Then clone the repository and start the local server and web client:

```sh
git clone https://github.com/SemanS/peer-app.git
cd peer-app
vp i
vp run dev
```

Open the pairing URL printed by the dev runner. Use `vp run dev:desktop` for the Electron client.
The [development guide](docs/operations/development.md) covers state directories, remote access,
tests and platform prerequisites. Run `vp run release:local:check` before packaging a build.

## Documentation and contributions

The [documentation index](docs/README.md) links to user guides and maintainer documentation.
Start with [permission modes](docs/user/permission-modes.md),
[source control](docs/user/source-control.md) or [remote access](docs/user/remote-access.md).
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Peer is under development. Report bugs in [this repository's issues](https://github.com/SemanS/peer-app/issues).

## Upstream and license

Peer is based on [T3 Code](https://github.com/pingdotgg/t3code). Its MIT license and copyright
notices are preserved in [LICENSE](LICENSE). Upstream documentation, packages and services use
the T3 Code name. They belong to the upstream project; Peer is a separate fork.
