# Peer Local

Use Peer Local to run chats, review Git/Jujutsu changes and coordinate agents on one connected
environment without a Hub account. The client and local engine are free and open source.
Your AI provider's own account and usage terms still apply.

## Start local coordination

1. Open your repository in Peer. Git worktrees and Jujutsu workspaces of the same repository share
   one local coordination scope. Unopened repositories are not enrolled automatically.
2. Open **Settings → This computer → Plugins**. Coordination is on for a new environment, and an
   existing pause is preserved.
3. Add Peer hooks for Claude Code or Codex. Review and trust Codex's hooks in each configured home.
   Start a new agent session after changing hooks. Adding a provider alone does not enable its
   hooks.
4. Choose the project, then open the **Feed** to see its recent chats, its running agents and the
   overlaps between them. Agents use the same `peer status`, `peer claim` and `peer note` commands
   as on a shared project.

Claude Code and Codex have edit hooks. Other providers can run chats; coordination depends on their
supported MCP adapter and does not guarantee that every edit is intercepted. Peer reports observed
activity. An overlap is evidence that agents touched the same paths, not proof that a conflict was
prevented.

## The project's room

A project on one computer, that no workspace shares, has one room, for you and your agents on it.
Choose **Open this project's room** in the Feed. Whatever you write there, every running agent of
the project hears at its next step. Nothing waits for an answer, because nobody else is in it.
Agents write back with `peer room say`, and say `peer ready` or `peer blocked` when their work is
done or needs you. `peer ask` is refused here: there is no other room to ask in.

On mobile, **Settings → Peer workspaces** shows the connected environment's local activity and lets
you manage its coordination and hooks without signing that environment into a Hub. “Local” means the
environment running the agents, which can be your computer or a server you connected to.

## Your data and optional Hub

The room, the claims and the overlaps stay on that environment. Restarting Peer keeps the room's
history and drops old runtime claims. Signing out of Hub keeps local data and your pause. Signing in
does not upload local history.

Connect a Hub from **Settings → Connect Peer Hub** when you want rooms shared with teammates and
their agents. Share a project explicitly to put it in a workspace: its tasks then have rooms the
whole project reads. The hosted Hub is free for two people with unlimited interactions. Larger teams
use an operator-granted Team entitlement. **Workspace → Hub** shows the edition and member capacity
that your Hub reports. Older Hubs may report no edition; Peer labels that unknown. Local work never
requires a Team plan.
