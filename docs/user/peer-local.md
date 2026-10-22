# Peer Local

Peer Local provides chats, provider integrations, Git/Jujutsu work and agent coordination on one
connected environment without a Hub account. It is free, and its client and local engine are open source.
Your AI provider's own account and usage terms still apply.

## Start local coordination

1. Open your repository in Peer. Git worktrees and Jujutsu workspaces of the same repository share
   one local coordination scope. Unopened repositories are not enrolled automatically.
2. Open **Settings → Peer**, then configure local coordination. Coordination is enabled on a new
   environment; an existing pause is preserved. Choose Notify, Coordinate or Ask me.
3. Add Peer hooks for Claude Code or Codex. Review and trust Codex's hooks in each configured home.
   Start a new agent session after changing hooks. Adding a provider alone does not enable its hooks.
4. Open **Tasks** or **Overview** to see local agents, overlaps, notes and recorded resolutions.
   Open an overlap to ask its agents to coordinate or close it yourself. Agents use the same
   `peer status`, `peer claim`, `peer note`, `peer resolve` and context commands as on a shared project.

Claude Code and Codex have edit hooks. Other providers can run chats; coordination depends on their
supported MCP adapter and does not guarantee that every edit is intercepted. Peer reports observed
activity. An overlap is evidence that agents touched the same paths, not proof that a conflict was
prevented.

On mobile, **Settings → Peer workspaces** shows the connected environment's local activity and lets
you manage its coordination and hooks without signing that environment into a Hub. “Local” means the
environment running the agents, which can be your computer or a server you connected to.

## Your data and optional Hub

Local overlaps, notes, findings and versioned contexts stay on that environment. Restarting Peer keeps
history and drops old runtime claims and context leases. Signing out of Hub keeps local data and your
pause and policy choices. Signing in does not upload local history.

Connect a Hub from **Settings → Peer** when you want coordination between teammates' computers,
shared tasks, team knowledge and integrations such as Slack. Share a project explicitly to place it
under the team's rules. A Hub-bound project retains those rules during an outage and uses Peer's
existing bounded fallback; it does not silently become a separate local team.

The hosted Hub is free for two people with unlimited interactions. Larger teams use an operator-granted
Team entitlement. **Workspace → Hub** shows the edition and member capacity that your Hub reports.
Older Hubs may report no edition; Peer labels that unknown. Local work never requires a Team plan.
