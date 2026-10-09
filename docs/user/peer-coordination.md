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
- **B-mcp · advisory tools:** an agent can ask the Hub about paths before editing. Peer cannot stop its edits; follow each tool verdict.
- **C · observed after work:** Peer reports uncommitted paths after completed work. It cannot prevent
  overlaps or attribute every change to one agent.

Agents without Peer hooks get coordination through their `peer_*` MCP tools. Peer threads of Cursor,
Grok, OpenCode (when Peer starts its server), and Antigravity receive them automatically and report
only paths they claim. Approval modes may ask before these tools run. For a CLI in herdr, add an MCP
server named `peer` with the command in Settings → Workspaces and let its `env` pass `HERDR_PANE_ID`
from the agent's environment. Claude Code and Codex use their Mod or hooks and need no additional
server. The **Coordination tools (MCP)** plugin turns the tools off.

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
them read the whole request, write an instruction of their own, choose a local repository and Claude Code or Codex, then
**Accept & start** in their own environment. They can also dismiss it. Mobile exposes these
controls in **Peer workspaces**. A request never starts a colleague's agent automatically.

Acceptance takes ownership once across the recipient's computers. It does not prove the agent
started or completed the task. If startup or delivery cannot be confirmed, inspect the task and
herdr before starting another agent; Peer does not automatically retry the accepted request.

The sent list offers **Withdraw** while a request is pending; withdrawing it removes it from the
recipient's Needs you and keeps its task on the board. Pending requests expire after 14 days;
answered, withdrawn and expired requests remain available for 30 days. Each project allows 16
pending requests to each teammate, 64 in a recipient's inbox and 30 new requests per sender per hour.
Accepted requests keep their text for recovery, and the list shows all pending and the 20 newest
closed requests.

Agents can inspect their sent requests with `peer request list` and withdraw one with
`peer request withdraw <id>`. A Hub refusal explains what must change; a lost reply is uncertain
and names the operation id to use when repeating the send.

New teammate requests use this device's notification and sound settings while T3 Code is open;
notices include the sender and title. Mobile lists sent requests with Withdraw in **Peer
workspaces**; phone alerts come from Needs-you alerts when those are enabled.

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

## Webhooks

Workspace owners and admins can send signed notifications to Slack or a public HTTPS endpoint.
Notifications carry short titles and links; they never include transcripts or context text.
Ask your Hub administrator to add the destination in the workspace’s `webhooks/` files, store its URL
as a workspace secret, and run `peerhub workspace apply`. In Settings → Workspaces → Webhooks,
open a workspace’s delivery health, inspect failures, send a test, or requeue failed deliveries.
The mobile workspace screen also shows health and retry actions for owners and admins.

## Notify agents

Use **Notify agents** on a project to share a short announcement with the whole project or one task.
Choose how long it applies. Agents hear it once at their next step; idle agents can wake unless you
untick **Wake idle agents** or turn waking off for their computer. Withdraw it when it no longer
applies; expiry ends it automatically.

Expand **Receipts** to see the audience. **Offered to adapter** does not mean read. **Verified in model
input** requires the Claude Mod’s delivery proof. **Acknowledged** means the agent ran
`peer announcements ack`. Agents can read and acknowledge announcements, but cannot post them.

Project leads and workspace admins manage announcement credentials in project settings. Copy the
secret when you create it; it cannot be read again. Revoke it when the service no longer needs it.
A credential can post or withdraw its own information, but cannot read the workspace or wake agents:

```sh
curl -X POST https://your-hub/v1/workspaces/acme/projects/app/announcements \
  -H 'Authorization: Bearer pan_YOUR_PROJECT_CREDENTIAL' \
  -H 'Content-Type: application/json' \
  -d '{"text":"Main CI is red: check it before merging.","topic":"main-ci","op":"build-123"}'
```

Reuse `op` when retrying the same post. A new post on the same topic replaces that service’s previous
announcement. Mobile supports posting, receipts, withdrawals and credential revocation; create new
credentials on web or desktop.

## Agent commands

Agents run `peer` from their session's shell. People manage work in the Peer app: open **Work**,
then the task. From a terminal in a workspace project, `peer status`, `index`, `context`,
`knowledge` and `log` also provide a public view; those reads do not acknowledge an agent's
notes or record its input versions. `peer help` works from any terminal.

A command finishes with one of five results. **Done** (exit 0) prints its answer. **Usage**
(exit 2) means its arguments need correction. **Refused** (exit 3) means Peer declined it;
follow its `Next:` step. **Uncertain** (exit 4) means it may or may not have taken effect:
run `peer status` before repeating it. A `peer request` can safely be repeated with the same
arguments and operation id. **Peer not running** (exit 5) means nothing was sent; start Peer
and try again. Failures start with a line such as `peer: refused: ...`, followed by `Next:`.
A pipe such as `| head` can hide the exit status, so read the first line.

Commands wait 15 seconds, or 150 seconds for `peer find`. `PEER_CLI_TIMEOUT` changes this
wait in seconds; it must be a positive number. A timeout does not prove the command failed.

Sessions started with Peer's Claude hooks or the Peer Mod carry a private credential.
A terminal cannot write as an agent using its session id alone once that credential is bound.
Sessions already running during this update keep working without a token for the compatibility
release; start a fresh session before the following release. Codex sessions work once Peer's
hooks are installed and trusted for their profile. If a tool removes the credential from
commands, set `PEER_CLI_CREDENTIAL=session-id` in Peer's environment to accept a registered
session id alone. Calls without a session still cannot change coordination state.

### Domain offers

Peer joins the workspace that holds your email domain when you sign in. Other workspaces listing the same domain appear as offers in the first-run step, Settings → Workspaces and mobile Peer workspaces. Choose Review to see who holds the domain, who created the offered workspace, and what joining shares with its members, then confirm to join. Leaving a workspace keeps Peer from joining it automatically on this environment.

Settings labels domains as verified through DNS, claimed, or listed only. If the domain already has a workspace, creating another starts with automatic domain joining unchecked. With an older Hub that lists several domain matches, Peer asks you to review each instead of joining them automatically.

To prove control of a domain, ask your Hub administrator for the TXT record from workspace
verification and have the person managing your DNS publish it. The administrator then verifies the
workspace again. Listing a domain alone does not prove ownership.

### Members, removal and the audit log

Owners and admins manage membership in **Settings → Workspaces → Members**. Remove first previews
the shared-capacity keys and invitations affected, and any projects that still name that person in
configuration. A removed person loses workspace access and cannot rejoin through their email domain.
Use **Invite back** to readmit them; **Withdraw** cancels a pending invitation. On an older Hub,
removal has no preview and may allow a domain member to rejoin; update Peer Hub for durable removal.

Open **Shared-capacity keys** to see key references, their environments and expiry, and use
**Revoke keys** to end access for one project on one environment. Members can inspect and revoke
their own keys, including on a lost laptop. Keys carry no secret values in this view. Revocation
may wait while a gateway is unavailable; the pending warning remains until the Hub confirms deletion.

**Sign out everywhere** ends all your Hub sessions and revokes your shared-capacity keys. Use it
when an environment is lost or no longer trusted. Local repositories and threads stay on those
environments. An older Hub requires an update before it can perform this action. Mobile offers the
same action and shows when an admin has removed you from a workspace.

New shared-capacity keys expire after 30 days. Peer renews an enabled provider when its key has seven
days or less remaining; the previous key lasts until its original expiry so ongoing work can finish.
Removal, signing out everywhere and revocation end those older keys too. A revoked provider must be
enabled again to get a new key. Older keys without an expiry stay unchanged until renewed or revoked.

The **Audit log** under each workspace is available to owners and admins. Open it or refresh to see
membership, configuration, key and work changes, filter by group or person, and load older entries.
Mobile provides a read-only log. The log identifies the acting person and session by reference and
contains no key or session secrets. Turn Audit off in Peer plugins to hide the log; membership
management and key revocation remain available.

When offboarding someone, remove their Peer membership, check that pending key revocations finish,
withdraw remaining invitations, and remove their access at your git host and other services.
Review local clones and credentials separately: removing Peer access cannot erase their copies.

## Workspace tools

Tools proposed by a workspace wait until you approve their definitions on the computer running your agents. After an upgrade, existing tools need this review once. Open Settings → Workspaces → Tools on this computer, or choose the workspace tools item in Work → Needs you. On mobile, use Tools on this computer in Peer workspaces. Review the command or destination, then approve tools individually or together, or keep them off. Changes to what runs or where it sends data ask again.

For each named secret, store a value in Peer or allow its environment variable for that workspace. You can forget either choice at any time. Secret values stay on that computer. Leaving the workspace or signing out forgets its tool choices and secrets.

Turn a tool off from the same screen. Claude applies the choice at its next turn; running Codex conversations keep the tool until their session restarts. Turning it back on requires reviewing its current definition. Approving or managing secrets from another device requires owner access to the computer; a standard paired device can view tools and turn them off.

### Pull requests confirmed by GitHub

Tasks show how many linked pull requests merged. **Verified by GitHub** means every linked PR has
signed delivery evidence; **unverified** means some states are still reported by their owner's Peer.
The pull request list names each source and explains disagreements. When GitHub missed a merge,
an admin can redeliver it from the repository's webhook settings within three days, or a person can
close the task. A closed PR that did not merge continues to block an agent's completion.

An admin enables verification through **Settings → Workspaces → GitHub verification**, using a
sealed workspace secret and a GitHub repository or organization webhook. GitHub must reach the
Hub's address. Personal-account repositories each need their own webhook. Agents inspect the same
facts with `peer delivery [task]`. Work outside github.com, including GitHub Enterprise Server, is
closed by a person. Mobile **Peer workspaces** shows the same badge and pull request list.

## Merge conflict forecast

Peer predicts textual merge conflicts between committed branches on this computer. Predictions are
advice: agents hear a changed prediction at their next step, and Work shows predicted conflicts and
task badges. Run `peer forecast` from an agent for details. Predictions never block editing or merging
and stay on the computer running Peer.

Git 2.38 or newer is required. Change **Merge conflict forecast** in **Settings → Workspaces** to turn
it off or on. **Forecast teammates’ branches** is off by default; turning it on lets Peer fetch only
the named qualifying branches from origin. Mobile shows predictions and their state; change the
settings on web or desktop.

Predictions cannot see uncommitted edits, unpushed teammate branches, or builds that fail without a
textual merge conflict. Files with a `merge=union` rule or a custom merge driver are judged by Git’s
plain text merge, so the actual merge can differ.

## Task dependencies

On a task, Claude Code and Codex agents can run `peer depends <task>...`, `peer depends --remove <task>...`, or `peer depends` to list both directions. Peer gives them a short reference at start and tells changes at their next step. It does not wake idle agents for dependencies, and no dependency blocks `peer review` or `peer done`. Other providers can use the same task controls through the app.

In Work, open a task's menu → Depends on, or its task page, to add or remove a task from the same project. Blocked by marks an open or in-review dependency; closing or merging that work clears the mark. Cycles are refused. Removing a task clears its relationships, and a new task with the same key starts fresh. On mobile, open Settings → Peer workspaces and select a task to see and change Depends on and Needed by. Older Hubs show no dependency controls.

## Hand off for review

Run `peer review` after publishing your shared context and checking changed inputs. Peer stores a bounded package of the task’s shared context, the exact input versions read, overlap agreements and linked pull requests. It never copies a private conversation or an overlap’s discussion notes. Reviewers open the task’s context page to read each author’s package; `peer handoff <task>` reads it as a reference.

On a task with one of your threads, **Hand off for review** moves it into review; **Update handoff** refreshes its package. The first review response still confirms the transition even if publishing fails. A later context version is shown as a notice rather than changing the saved package.

Publishing defaults to **Pull request comment**. Workspaces settings also offer **Not at all**, which keeps the package in Peer only. Each project can opt in to **Pull request description**. Publishing needs an active GitHub plugin, github.com and a signed-in GitHub CLI on the connected environment. Public repositories and repositories whose visibility cannot be checked receive only a pointer and counts. Other people’s pull requests are never edited.

**Withdraw** removes your package and your own published region and comments; it leaves the task’s status unchanged. If GitHub cannot be reached, the result names any manual cleanup. Withdraw before switching the plugin off to remove published blocks. Peer workspaces on mobile shows the package under the selected task and the target setting.

## Needs you and Phone alerts

**Work → Needs you** on web and desktop lists approvals, answers, team requests, overlaps that need a decision, changed inputs blocking a handoff, then finished work. Its count includes all of these. Working agents are folded below the list. An **Inputs changed** card shows the versions the agent read and the current versions, including removed inputs. Open its task context to inspect them; the agent must update its inputs before handoff.

On mobile, open **Needs you** from the Home list or **Settings → Peer workspaces**. Review a request and choose a computer to **Accept request and start agent**. A computer explains anything blocking startup. Accepted requests remain under **Recently accepted**; acceptance does not confirm that an agent started. Check herdr before starting another agent when startup was not confirmed. For an unanswered overlap, use **Ask again** or **Close it yourself**. Answer a blocked herdr agent in herdr; mobile can show its recent work.

**Phone alerts** in web **Settings → Workspaces** and mobile **Settings → Peer workspaces**, under each computer, are off by default. Turn them on for one computer. Alerts carry titles only, never prompts, context text, notes, file paths or terminal output. They require T3 Connect with agent activity publishing enabled, and follow its notification and quiet switches. A direct connection alone cannot send them. Only the computer’s owner can change this setting. An alert opens its Needs-you item; an item already resolved says it has been handled.

### Shared resources and project patterns

An agent can reserve a named resource with `peer claim resource:deploy-staging --ttl 30m --intent "deploying"` and release it with `peer release resource:deploy-staging`. Leases last from one minute to eight hours; the default is 30 minutes. A refusal names the holder and expiry. Wait for release or expiry before trying again. `peer release` drops the agent's file claims and all its leased resources and patterns.

Project configuration can give paths their own coordination policy. An exclusive pattern, such as `migrations/**`, reserves the whole matching scope for 30 minutes after the last edit; release it with `peer release "migrations/**"`. A lapsed or lost hold is no longer permission to rely on that scope. Automatic edit coordination follows Claude Code and Codex with Peer hooks.

Held resources appear below Overlaps in Work and in mobile's Peer workspaces screen. The holder's person, a project lead or a workspace admin can release them. A row checking expiry remains visible until the Hub confirms whether the lease was renewed.

## Recipes

Recipes are short procedures you ask your own agent to follow. Run `peer recipe` to list them, or `peer recipe catch-up` to print one. Coordinating agents hear which recipes are available once when their session starts. A recipe marked “reads only” reports what it found and asks before changing anything. A handoff saves the current state before releasing claims, then sends a request your teammate chooses to accept; it never prompts their agent.

With the Peer Mod in Claude Code, `/peer <recipe> [input]` schedules the recipe after the command returns. Hook-only Claude sessions and Codex use `peer recipe`; Codex also gets the `peer-recipes` skill with Peer's hooks. MCP clients can read the same recipes through their prompts and the recipe tool.

On a task page, **Ask your agent** sends a recipe to your own coordinating agent on that environment. Agents waiting for an answer are disabled until you answer them. Peer workspaces on mobile has the same action. A prompt typed into a herdr terminal cannot be recalled; a queued message in a Peer thread can be cancelled from that thread. If delivery is uncertain, check the agent before trying a new message; repeating the unchanged draft uses the same operation.

Settings → Workspaces lists the available recipes and commands to copy. Turn **Agent recipes** off in Peer plugins to hide the controls, prompts and Codex skill. Recipes are advice: the agent still chooses each step and reports what happened.

## Metrics

Open **Work → a project → Metrics**, or open the project's metrics under **Settings → Workspaces**.
Measurements come from the environment that runs your agents. Hook measurements cover Claude Code
with Peer Mod or Peer hooks and Codex with Peer hooks; each metric states its source and coverage.
Other agents have no hook measurements. **Not measured** means there is no supported measurement,
not a zero. Histograms show upper bounds, and token estimates are not money.

Local metrics start on. Team metrics need two choices: a workspace owner or admin enables **Team
metrics**, then each person chooses **Share this environment’s metrics**. Both start off. Sharing
starts today and sends content-free counts, timing buckets and opaque task totals. Team device sums
appear only with at least three contributing computers. The Hub's coordination outcomes can appear
with fewer. Shared-capacity spending uses its own billing period; money per task is not measured.

**Stop sharing and erase my rows**, signing out, or turning the metrics plugin off deletes what this
computer uploaded. Failed deletion remains pending and blocks new uploads until it succeeds. Local
measurements stay here. Turn sharing off before leaving a workspace. **Erase local metrics** removes
local history separately.

**Enable debug for 24 hours** temporarily records detailed local coordination data. It can include
prompts, paths and replies; it never uploads as metrics. Enabling it again replaces the previous
log. **Stop debug** ends it and **Delete debug log** removes it. An operator can force debug logging
on for diagnostics, as the settings show.

Choose a UTC range of at most 366 days and **Download CSVs** or **Download JSON**. Exports save on the
client you use and identify their scope and sources. Mobile shows a read-only 28-day summary;
sharing, debug controls and export are available on web and desktop.
