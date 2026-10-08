# Team agents

Sign in and open a project in **Settings → Workspaces** on the environment that runs your agents.
Install [herdr](https://herdr.dev/docs/install/) there and start it. A remote browser or phone uses
that environment's runtime, repositories, and agent logins.

On macOS with Homebrew, install it with `brew install herdr`, then run `herdr`. For a headless
environment, run `herdr server` under your usual process supervisor. Other platforms and manual
downloads are covered in the install guide. Peer shows the prerequisite until that environment's
herdr server is running; it does not install a global runtime automatically.

In **Work**, choose **Start agent on task**, select Claude Code or Codex, and review the first prompt.
Peer creates a separate git worktree and a `feature/` branch containing the task's issue key when it
has one. It assigns the agent to the task before sending the prompt. On mobile, open **Settings →
Peer workspaces**, select a task, then start the agent. Projects requiring approved commercial or
shared capacity use a Peer thread with an allowed provider instead of this local CLI launch.

If an agent needs a trust or approval answer, open it in herdr and answer there. If launch or prompt
delivery could not be confirmed, inspect herdr before retrying. The task checkout stays available so
an uncertain launch cannot discard work. Stopping an agent does not close its task or erase its saved
handoff context.

Enable coordination in **Settings → Workspaces**. For Claude Code 2.1.291 or newer, enable **Peer
Mod**; it replaces Peer's Claude hooks. For Codex, choose **Add to Codex**, review the Peer commands
for each listed Codex home, then choose **Trust these Peer hooks**. Custom and managed profiles may
use separate homes; a new profile needs installation and review before its sessions coordinate.
The same review controls are in **Peer workspaces** on mobile. Changing the
adapter takes effect for newly started sessions; existing sessions keep their adapter. Turn the Mod
off to remove it from new sessions. On mobile, the same Mod control is in **Peer workspaces**.

Each herdr agent shows the coordination its running session actually supports:

- **A · action enforced:** a live Claude Mod checks tracked edits with the hub before they run.
- **B · hooks active:** a live session runs Peer hooks; blocking depends on the hook deadline.
- **C · observed after work:** Peer reports uncommitted paths after completed work. It cannot prevent
  overlaps or attribute every change to one agent.

Task history shows the hub's coordination events. Peer sends short coordination updates when an
idle agent needs to answer an overlap; shared context waits for the agent to read it. A prompt queued
in herdr is not evidence that the agent read or used the update.

Agents use `peer context` to read shared work with an exact version, and `peer log` to inspect its
coordination history. If an input changed, read its current context before accepting it with
`peer ack <task>`. A declared task cannot enter review or finish while its shared inputs are stale.
Describe the work normally: you do not need to name the other agents or put Peer commands in your
prompt. Peer supplies a short index of team activity and announces new work and context versions
during the run. Agents choose relevant inputs, read their exact versions, and check changes before
handing a task over for review. Two threads without task assignments still see each other through
the project's shared context. Task-specific handoff requires a task assignment in Work.

A change notice does not count as reading the new version. When an agent publishes its own updated
context, its existing receipt advances with that publication; colleagues still need to read the
update themselves.

The task's history lets team members check these changes without opening another agent's private
conversation. Saved context survives its author's session; a new keeper can continue the work.

Use **Request a teammate** next to a project to send a task title and prompt to a workspace
member's verified email. Agents can send the same request with `peer request <email> "<prompt>"`;
`--title` names the task and `--op` supplies a stable retry id. Without a task assignment, Peer
creates a task with the request. Repeating the same operation does not create another request.

The recipient sees it in **Needs you**, including after reconnecting. **Review request** lets
them read and edit the prompt, choose a local repository and Claude Code or Codex, then
**Accept & start** in their own environment. They can also dismiss it. Mobile exposes these
controls in **Peer workspaces**. A request never starts a colleague's agent automatically.

Acceptance takes ownership once across the recipient's computers. It does not prove the agent
started or completed the task. If startup or delivery cannot be confirmed, inspect the task and
herdr before starting another agent; Peer does not automatically retry the accepted request.

Accepted requests retain their prompts for manual recovery. The view includes every incoming
pending request and the 20 newest sent or resolved requests. A project admits up to 64 pending
requests per recipient; answering one frees a slot. Older records and replay ids stay in the Hub.

## Peer plugins

Each Peer feature is a plugin: team requests, Observe, herdr agents, GitHub, shared capacity, `peer find`,
`peer ask` and Knowledge. The owner of an environment turns them off and on in **Settings → Workspaces →
Peer plugins**, or in **Peer workspaces** on mobile. The choice belongs to that environment, survives a
restart, and applies at once. Memory is listed only in builds that include it, and starts off.

A plugin that is off adds nothing. Agents get none of its text, its `peer` command is refused and left out
of `peer help`, and its sections, actions and pages disappear from Work, Settings and the command
palette. A page that belongs to it says it is off, and an owner can turn it on there. A plugin also stays
inactive while the Hub you signed in to does not serve the feature it needs; Settings then says the Hub
must be updated.

Turning a plugin off undoes what it set up outside Peer, and turning it on again does not bring that back.
Turning off shared capacity revokes this environment's gateway keys and removes the provider instances it
created, so each project shows shared capacity off afterwards. Turning off Observe stops sending views and
stops sharing this environment's threads. Requests the Hub keeps for you stay, and show again in **Needs
you** when you turn requests back on.
