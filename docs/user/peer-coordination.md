# Team agents

Sign in in **Settings** and open a project under **Projects** on the environment that runs your agents.
Agents run in [herdr](https://herdr.dev/), a terminal workspace manager. A remote browser or phone
uses that environment's runtime, repositories, and agent logins. What each workspace, project, person
and computer changes in Settings is in [Peer settings](./peer-settings.md).

**The desktop app on macOS and Linux starts a herdr of its own**, so there is nothing to install.
If you already run herdr, Peer uses yours and leaves it alone. Peer keeps using its own herdr only
while it has agents running that yours could not take over; then
**Settings → This computer → Coordination & plugins** says that yours is running too. The headless server, `npx t3`, Windows and WSL do not bundle herdr: install
[herdr](https://herdr.dev/docs/install/) there and start it. On macOS with Homebrew, run
`brew install herdr`, then `herdr`; for a headless environment, run `herdr server` under your usual
process supervisor. Peer shows the prerequisite until that environment's herdr server is running.

The herdr row in **Settings → This computer → Coordination & plugins** shows which herdr is in use and what
it is doing. For Peer's herdr it offers:

- **Turn off** and **Turn on.** Off persists across restarts, and Peer starts nothing while it is
  off. Turning it off while agents run asks first, and says which of them can resume later.
- **Restart.** Use it to recover from a failure or to apply an update that waits for your agents to
  finish. It asks first when agents are running.
- **Open herdr.** In the desktop app this opens a terminal attached to Peer's herdr. Anywhere else,
  or when no terminal can be opened, the row shows a command to copy and run on that computer.

Your own herdr is never turned off or restarted from here.

Stopping herdr stops the agents in it. It restores the layout when it starts again, and brings back
Claude Code and Codex agents only when herdr's integration for that agent is installed. The
integrations appear as rows under the herdr row: **Install** (or **Update**) names the files in
your Claude Code or Codex configuration that it changes, and **Remove** undoes it. Peer installs
nothing there until you confirm. Without an integration, a restarted herdr cannot resume that agent.

Turn Peer's herdr off before you uninstall Peer. One left running keeps running until you log out
or restart the computer. To stop it sooner, run the attach command (shown in the herdr row, or run
by **Open herdr**) with `server stop` added at the end, for example
`'/path/to/herdr' --session peer-1a2b3c4d server stop`; this needs the herdr program that command
names, which is part of the app. Installing Peer again picks a running herdr up.

In **Tasks**, choose **Start agent on task**, select Claude Code or Codex, and review the first prompt.
Peer creates a separate git worktree and a `feature/` branch containing the task's issue key when it
has one. It assigns the agent to the task before sending the prompt. On mobile, open **Settings →
Peer workspaces**, select a task, then start the agent. Projects requiring approved commercial or
shared capacity use a Peer thread with an allowed provider instead of this local CLI launch.

If an agent needs a trust or approval answer, choose **Open herdr** in
**Settings → This computer → Coordination & plugins** (or attach to your own herdr) and answer there. If launch or prompt
delivery could not be confirmed, inspect herdr before retrying. The task checkout stays available so
an uncertain launch cannot discard work. Stopping an agent does not close its task or erase its saved
handoff context.

Enable coordination in **Settings → This computer → Coordination & plugins**. For Claude Code 2.1.291 or
newer, enable **Peer Mod**; it replaces Peer's Claude hooks. For Codex, choose **Add to Codex**, review the Peer commands
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
server named `peer` with the command in Settings → This computer → Coordination & plugins and let its `env`
pass `HERDR_PANE_ID` from the agent's environment. Claude Code and Codex use their Mod or hooks and need no additional
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
the project's shared context. Task-specific handoff requires a task assignment in Tasks.

A change notice does not count as reading the new version. When an agent publishes its own updated
context, its existing receipt advances with that publication; colleagues still need to read the
update themselves.

The task's history lets team members check these changes without opening another agent's private
conversation. Saved context survives its author's session; a new keeper can continue the work.

Use **Request a teammate** next to a project to ask someone on that project: pick them from its
members, pick one of the project's open tasks or write a new one, and say what you need. A new task
is added to the project when you send the request and stays if it is declined. People of the
workspace who are not on the project are listed but cannot be picked, because a request only reaches
a member of the project. Agents can send the same request with `peer request <email> "<prompt>"`;
`--title` names the task and `--op` supplies a stable retry id. Without a task assignment, Peer
creates a task with the request. Repeating the same operation does not create another request.

The recipient sees it in **Needs you**, including after reconnecting. Opening it shows the whole
request, fenced as the sender's words, where the agent will run and on which capacity. They write an
instruction of their own, choose a local repository and Claude Code or Codex, then **Accept & start**
in their own environment. **Decline…** asks for an optional reason (up to 300 characters) that the
sender sees in their sent list. Mobile exposes these controls in **Needs you** and **Peer
workspaces**. A request never starts a colleague's agent automatically.

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

## The sidebar: Tasks and Chats

The sidebar has two views. **Tasks** lists the team's tasks; **Chats** lists your own chats on this
computer. The line under the switch says which project they show: "Team tasks in Receipt printer",
"Your chats in all projects". Switching views also switches the main area to the screen that view
showed last: the Overview or the task you were on, and the chat you were reading.

The **project button** at the top chooses the project for both views, so the work of different
projects never mixes. Its menu lists each workspace's projects with their folder and how many of
their tasks are active or wait for you, then the projects on this computer that no workspace shares,
then **All projects**. **Add a project…** starts one. Under the list the menu acts on the chosen
project: its **Coordination** line (which policy applies, who set it and how many path rules the
project has), with **Settings** where the project decides and **Change…** where this computer's
default does; **Project settings**; **Open folder** in your file manager; and **Remove from
workspace…**, which whoever shared the project from Peer and the workspace's owner or admins see.

The Tasks view starts with **Search** (the command palette), **Overview** (the Work board) and
**Needs you** with its count (see [Needs you](#needs-you-and-phone-alerts)). With one project,
**New task** adds a task, and **More** holds **Request a teammate…**, **Notify agents…** and **New
chat without a task**; a plugin that is turned off takes its item away. Below come what holds now in
the project (its signals as tiles, such as Overlaps and Memory, and its active announcement) and
**Tasks**, with the number of active tasks and the project's tasks by area, two lines each: key and title, then the task's state and how many chats it has. A chip (**Review**, **Answer** or **Approve**) appears only while the task waits on you; the title opens the task's page, the chevron shows your chats with their agents' state, and a colleague's chats are counted in one line. **Done**
folds the finished tasks under their own count, and no count adds done tasks to active ones. Under a
rule are **Knowledge** ("N to keep", with **Shared context** beside it once an agent wrote one),
**Activity** (what already happened: the catch-up of what changed, settled overlaps, earlier
announcements, metrics, with "N new" for what changed while you were away), **Pull requests** (the
project's, where the environment supports them) and **Project settings**. With all projects, each
project is a card that counts its active tasks and what needs you, followed by its signals. A
project no workspace shares has no team tasks; its chats are in Chats.

**Overview** opens the **Work board**: one card per task of the chosen
projects in the columns **Needs you**, **In progress**, **Paused** and **Not started**, with
**Everyone** or **Mine**, a search and a list layout. A task waiting for your review, approval or
answer is under Needs you whatever its chats do; one whose chat waits for a colleague stays under In
progress, marked **Waiting on** that person. A column with no card is one line under the board, with
your chats that are on no task (**Open in Chats**) and the tasks that are done (**Show done** opens
the list on its **Done** tab). On the phone, **Work** on Home or in Peer workspaces shows the same
switcher, the project cards and each project's threads by state.

Each card opens the place to act on it:

- **Approve** opens the thread with its approval. Above it Peer shows the task, overlaps on the
  files the agent touches and resources held in the project. **Deny with a note…** declines and
  sends your note to the agent as your next message.
- **Answer** opens the agent's question. In a Peer project, **Mark this as a project decision** asks
  the agent to record your answer for the project, so it reaches Knowledge to keep.
- An overlap opens its page: what each agent changes, their notes as a conversation, **Request
  agreement** with an optional message for both agents, and **Close it yourself** once they did not
  answer.
- **Knowledge to keep** lists what agents marked for the project: keep it as written, edit it
  first, or dismiss it.
- **Review** on a task waiting for review opens the task's review: its handoff package and pull requests,
  its timeline, **Mark task done**, or **Reopen with a note…**, which reaches your own agent on the
  task as your next message.

A project's leads and the workspace's admins remove it for everyone in **Settings → Projects →** the
project **→ Basics → Delete project**, which lists what goes with it, asks for the project's ID and
goes through the same review as any other change. A project someone shared from Peer can also leave
from the project menu → **Remove from workspace…**, which whoever shared it and the workspace's
owner or admins see. With a Hub older than Peer settings, a project from the workspace's configuration
leaves only through that configuration. Clones on members' computers stay.

Colors say what kind of conversation a signal is: orange between agents (overlaps, held resources,
predicted conflicts, Blocked by), violet for context and knowledge (task context, Knowledge to keep,
Memory), teal between people and agents (announcements, requests, watching a thread), green for
delivery (finished work, review, pull requests), amber for what waits on you and blue for agents at
work.

### A task's page

Click a task's title, in the sidebar, on the board or in the list, to open its page. It names the
task's state in words and what waits on you, with the one action that fits: **Review handoff #n**
for a task in review, **Answer in chat** or **Approve in chat** for a chat of yours that waits, and
**Start a chat** otherwise. Below it are the task's chats (yours open; a colleague's runs on their
computer, so only they can open it, and **Ask Ana** sends them a request), its task context with
**Open task context**, what lately happened on the task, and, folded, its branch, runtime,
handoffs, context version and pull requests. The **…** menu is the task row's.

## Peer plugins

Each Peer feature is a plugin: team requests, Observe, herdr agents, GitHub, shared capacity, `peer find`,
`peer ask`, Knowledge and Ownership. The owner of an environment turns them off and on in
**Settings → This computer → Coordination & plugins**, or in **Peer workspaces** on mobile. The choice belongs
to that environment, survives a restart, and applies at once. Memory is listed only in builds that include it, and starts off.

A plugin that is off adds nothing. Agents get none of its text, its `peer` command is refused and left out
of `peer help`, and its sections, actions and pages disappear from the sidebar, Settings and the command
palette. A page that belongs to it says it is off, and an owner can turn it on there. A plugin also stays
inactive while the Hub you signed in to does not serve the feature it needs; Settings then says that the
Hub's operator turned the feature off, or that the Hub must be updated, and **Settings → Workspace → Hub**
lists every feature of the Hub as on, off or waiting for an update. An older Hub does not say which of the
two it is, and reads as needing an update. Until a Hub has answered (you are signed out, or Peer has not
reached its Hub since it started), such a plugin waits for one: it works once you sign in and the Hub
answers.

Turning a plugin off undoes what it set up outside Peer, and turning it on again does not bring that back.
Turning off shared capacity revokes this environment's gateway keys and removes the provider instances it
created, so each project shows shared capacity off afterwards. Turning off Observe stops sending views and
stops sharing this environment's threads. Requests the Hub keeps for you stay, and show again in **Needs
you** when you turn requests back on.

## Webhooks

Workspace owners and admins can send notifications to Slack, Teams or a public HTTPS endpoint of their
own. Notifications carry short titles and links; they never include transcripts or context text.
In **Settings → Workspace → Integrations**, **Add webhook** takes a name, a format (Slack, Teams or Generic),
the destination URL, the events to send and the projects it covers. The URL is stored as a workspace
secret and never shown again. A generic webhook is signed so its receiver can verify it; its signing
key is shown once, to copy to the receiver. A webhook is paused, resumed and deleted from its **Edit**.
Each webhook shows its delivery health: open its **Details** to inspect failures, send a test, or
requeue failed deliveries.
With a Hub older than Peer settings, an administrator adds the destination in the workspace’s `webhooks/`
files, stores its URL as a workspace secret, and runs `peerhub workspace apply`; the page still shows
health and requeues. The mobile workspace screen also shows health and retry actions for owners and
admins.

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

Agents run `peer` from their session's shell. People manage work in the Peer app: open **Tasks**,
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

Peer joins the workspace that holds your email domain when you sign in. Other workspaces listing the same domain appear as offers in the first-run step, Settings and mobile Peer workspaces. Choose Review to see who holds the domain, who created the offered workspace, and what joining shares with its members, then confirm to join. Leaving a workspace keeps Peer from joining it automatically on this environment.

Settings labels domains as verified through DNS, claimed, or listed only. If the domain already has a workspace, creating another starts with automatic domain joining unchecked. With an older Hub that lists several domain matches, Peer asks you to review each instead of joining them automatically.

To prove control of a domain, a workspace owner has the person managing your DNS publish the
workspace's TXT record. **Verify with DNS** next to the domain in **Settings → Workspace → General** shows
the record and checks for it with **Check now**, as `peerhub workspace verify <workspace> <domain>`
does from a terminal. The Hub names the record when it refuses a domain that another workspace has
claimed but not verified; once it is published, the owner checks again or retries the refused change.
Listing a domain alone does not prove ownership.

### Members, removal and the audit log

Owners and admins manage membership in **Settings → Workspace → People**. Remove first previews
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
Entries name people as the workspace does, say how long ago they happened (hover for the exact time)
and show the first characters of the session, which the copy button takes whole. Mobile provides a
read-only log. The log identifies the acting person and session by reference and contains no key or
session secrets. Turn Audit off in Peer plugins to hide the log; membership
management and key revocation remain available.

When offboarding someone, remove their Peer membership, check that pending key revocations finish,
withdraw remaining invitations, and remove their access at your git host and other services.
Review local clones and credentials separately: removing Peer access cannot erase their copies.

## Workspace tools

Tools proposed by a workspace wait until you approve their definitions on the computer running your agents. After an upgrade, existing tools need this review once. Open Settings → This computer → Tool trust on this computer, or choose the workspace tools item at the top of Tasks. On mobile, use Tools on this computer in Peer workspaces. Review the command or destination, then approve tools individually or together, or keep them off. Changes to what runs or where it sends data ask again.

For each named secret, store a value in Peer or allow its environment variable for that workspace. You can forget either choice at any time. Secret values stay on that computer. Leaving the workspace or signing out forgets its tool choices and secrets.

Turn a tool off from the same screen. Claude applies the choice at its next turn; running Codex conversations keep the tool until their session restarts. Turning it back on requires reviewing its current definition. Approving or managing secrets from another device requires owner access to the computer; a standard paired device can view tools and turn them off.

### Pull requests confirmed by GitHub

Tasks show how many linked pull requests merged. **Verified by GitHub** means every linked PR has
signed delivery evidence; **unverified** means some states are still reported by their owner's Peer.
The pull request list names each source and explains disagreements. When GitHub missed a merge,
an admin can redeliver it from the repository's webhook settings within three days, or a person can
close the task. A closed PR that did not merge continues to block an agent's completion.

An admin enables verification through **Settings → Workspace → Integrations**, using a
sealed workspace secret and a GitHub repository or organization webhook. GitHub must reach the
Hub's address. Personal-account repositories each need their own webhook. Agents inspect the same
facts with `peer delivery [task]`. Work outside github.com, including GitHub Enterprise Server, is
closed by a person. Mobile **Peer workspaces** shows the same badge and pull request list.

## Merge conflict forecast

Peer predicts textual merge conflicts between committed branches on this computer. Predictions are
advice: agents hear a changed prediction at their next step, and Tasks shows predicted conflicts and
task badges. Run `peer forecast` from an agent for details. Predictions never block editing or merging
and stay on the computer running Peer.

Git 2.38 or newer is required. Change **Merge conflict forecast** in **Settings → This computer → Coordination & plugins** to turn
it off or on. **Forecast teammates’ branches** is off by default; turning it on lets Peer fetch only
the named qualifying branches from origin. Mobile shows predictions and their state; change the
settings on web or desktop.

Predictions cannot see uncommitted edits, unpushed teammate branches, or builds that fail without a
textual merge conflict. Files with a `merge=union` rule or a custom merge driver are judged by Git’s
plain text merge, so the actual merge can differ.

## Task dependencies

On a task, Claude Code and Codex agents can run `peer depends <task>...`, `peer depends --remove <task>...`, or `peer depends` to list both directions. Peer gives them a short reference at start and tells changes at their next step. It does not wake idle agents for dependencies, and no dependency blocks `peer review` or `peer done`. Other providers can use the same task controls through the app.

In Tasks, open a task's menu → Depends on, or its task context page, to add or remove a task from the same project. Blocked by marks an open or in-review dependency; closing or merging that work clears the mark. Cycles are refused. Removing a task clears its relationships, and a new task with the same key starts fresh. On mobile, open Settings → Peer workspaces and select a task to see and change Depends on and Needed by. Older Hubs show no dependency controls.

## Impact overlaps

Impact overlaps connect work that changes a symbol with other work whose changed code calls it.
Agents hear bounded advice at their next step, once per item and again if its change grows more
severe. These notices never block an edit or wake an idle agent. File overlaps continue to work
independently.

Install CodeGraph on the environment that runs the agents, then initialize each checkout you want
to use with `codegraph init <path>`. Task worktrees have their own indexes. Keep an index current by
running that checkout's CodeGraph MCP server or by running `codegraph sync <path>` yourself. Peer
reads existing indexes and shows recovery commands in Settings → This computer → Coordination & plugins → Impact overlaps;
copying a command does not run it. You can separately opt in to indexing **new Peer task
worktrees** there, or in mobile Peer workspaces. That setting is off by default and does not
initialize existing checkouts.

In Tasks → Impact, expand a record to see both works, people, symbols, paths and change kinds.
Dismiss silences it for both sides; Reopen restores it. A dismissed record also reopens when a new
item appears or a change grows from body to signature to removed. On web and desktop a task's page shows
open counts, and the task's context page shows its records and changed provided interfaces.
Mobile shows the same records, Dismiss and Reopen for the selected task. These actions require an
authenticated session allowed to operate the selected environment.

A keeper can describe an interface in its shared context under `## Provides`, for example:

```markdown
- `applyDiscount` (src/discount.ts): returns total and saved, rounded half up to cents
```

The path is optional. Other bullets remain free text. When its code changes, readers of that
context hear that the provided interface changed since the version they read, with that version's
contract as team reference. A reader does not need an index for this notice.

Only session identifiers, symbol names, repository-relative paths, change kinds, revision counters
and provided flags go to the Hub for pairing. Source code, diffs, signatures and line numbers stay
on the environment. Remote browsers and phones use that environment's results; CodeGraph is not
needed on the viewing device.

Turn Impact overlaps off in Settings → This computer → Coordination & plugins, or in mobile Peer workspaces.
The environment operator can force it off with `PEER_IMPACT=off`; its controls then remain off and
locked with that reason. Turning it off removes that environment's footprints and stops its checks
and notices. Settings remains available to explain the state, local indexes, Hub support and last
contact. A Hub without impact support leaves file coordination unchanged.

## Plans

Before it edits, an agent can say what it will change, may change and uses, and what it provides. Peer
then tells it, and the agents whose work meets its plan, where the plans meet: both change the same
thing, or one uses what the other changes. A plan is advice. Nothing is blocked, held or ordered because
of one, and no idle agent is woken for it. Two sessions on one task never meet.

Every agent session starts with a line asking for a plan. The agent declares it with `peer plan`:

```text
peer plan                                   show your plan and what meets it
peer plan [--amend] [--change <item>]... [--maybe <item>]... [--uses <item>]...
          [--provides "<symbol> (<path>): <contract>"]...
peer plan --withdraw
<item> = <path> | <dir>/ | <path>#<symbol>
```

A declaration replaces the agent's plan; `--amend` adds to it. `--change` names what it will edit,
`--maybe` what it might, `--uses` what it relies on that others may change, and `--provides` the contract of
what it offers others, for example `Fee.refundCents (src/payments/fees.ts): integer cents`. A plan holds at
most 40 changes and maybes together, 40 uses and 10 contract lines. The agent declares again as its plan
changes. A plan ends with its session, or earlier with `peer plan --withdraw`. From a terminal outside an
agent session, `peer plan` lists the project's live plans, read-only.

A name after `#` is checked against the checkout's CodeGraph index when one is ready. Peer only reads it, as
Impact overlaps does. A name the index does not know stays as written, and the answer lists it with the
symbols it may have meant.

What agents hear:

- The answer to `peer plan` lists what meets the plan now: the other work and person, the item, whether
  the relation is **uncertain** (a `--maybe` is involved) or **observed** (the other session already changed
  the file), the other agent's contract as teammate text, and `peer ask <task>`. It stays within 1,500
  characters, and `peer plan` shows the rest.
- At their next steps, Claude Code and Codex agents hear each relation once, in at most 400 characters and
  three at a step. They hear it again when its contract changes, and once more after their context is
  compacted. Agents that use Peer's MCP tools read relations in the answer of `peer_plan`.
- With the Peer Mod, an agent that leaves plan mode without a plan hears one reminder.
- `peer status` ends with a line about the agent's plan.

If the Hub does not answer, `peer plan` ends uncertain: the plan may not be recorded. Peer sends the
newest declaration again when the Hub answers, and a newer one replaces it.

Only repository paths, symbol names and the contract lines an agent wrote go to the Hub. Source code, diffs
and line numbers stay on its computer. On web and desktop, a task's context page has a **Plans** section with
the live plans of its agents and the relations from that task's side, and the task's page counts them. Mobile
shows the same, read-only. People cannot edit a plan, and a plan never adds to **Needs you**.

Turn Plans off in **Settings → This computer → Coordination & plugins**, or in mobile Peer workspaces.
Turning it off withdraws this computer's plans and stops what agents hear about them. The environment
operator can force it off with `PEER_PLANS=off`; its controls then stay off with that reason. A Hub that does
not serve plans keeps Plans inactive until it is updated.

## Hand off for review

Run `peer review` after publishing your shared context and checking changed inputs. Peer stores a bounded package of the task’s shared context, the exact input versions read, overlap agreements and linked pull requests. It never copies a private conversation or an overlap’s discussion notes. Reviewers open the task’s context page to read each author’s package; `peer handoff <task>` reads it as a reference.

On a task with one of your threads, **Hand off for review** moves it into review; **Update handoff** refreshes its package. The first review response still confirms the transition even if publishing fails. A later context version is shown as a banner on the review, with **Compare** and **Open task context**, rather than changing the saved package.

Publishing defaults to **Pull request comment**. **Settings → This computer → Coordination & plugins** also offers **Not at all**, which keeps the package in Peer only. Each project can opt in to **Pull request description**. Publishing needs an active GitHub plugin, github.com and a signed-in GitHub CLI on the connected environment. Public repositories and repositories whose visibility cannot be checked receive only a pointer and counts. Other people’s pull requests are never edited.

**Withdraw** removes your package and your own published region and comments; it leaves the task’s status unchanged. If GitHub cannot be reached, the result names any manual cleanup. Withdraw before switching the plugin off to remove published blocks. Peer workspaces on mobile shows the package under the selected task and the target setting.

## Nothing lands unread

Before an agent's work lands, Peer gives it what its teammates have said to it. A step lands work
when it is a `git commit`, `git push`, `gh pr create` or `gh pr merge` in the agent's shell, alone or
inside a longer command, or when the agent runs `peer review` or `peer done`. Peer knows the shell
steps by the words of the command, so one hidden in a script or an alias is not recognized.

If a note, question or answer from a teammate's agent, or a person's request to settle an overlap, has
not reached that agent yet, Peer stops the step once. In the shell, the agent reads "Denied by
Peer: a message from a teammate waits for you", each message as quoted teammate text, and "Run the
commit again once you have taken it into account." `peer review` and `peer done` end refused instead,
with the messages below the first line and `Next:` naming the same command; the task stays where it
was. Running the step again goes through, unless something new came in meanwhile. A stop carries at
most 2,000 characters, and when more wait, it names `peer status` for the rest.

Advice never stops a step: an announcement waiting for the agent, for example, reaches it at its
next step, as before. Only agents are stopped: a terminal that is not an agent session never is. A
decision on an owner's call the agent asked for is a message to it: it is given at the step that lands
work, as a note is (see Owners and owner's calls).

Claude Code, with Peer Mod or hooks, and Codex are stopped in their shell steps. An agent that has
only Peer's tools is stopped at `peer review` and `peer done`. When Peer cannot answer within the
hook's deadline, the step goes on and the messages reach the agent at its next step; a push or pull
request Peer could not check in time is held until the agent tries again, as it always was.

## Owners and owner's calls

A task has at most one owner: the person whose agent first worked on it, the person who accepted a
request for it, or whom a project lead or a workspace admin names. An owner can hand the task to another
member or give it back, and owning a task gives no further right to change, close or delete it. A project
also has an owner map, which its leads and the workspace's admins edit on the project's Team page: each
area and each path pattern, such as `src/payments/**`, has an owner, and the most specific pattern that
matches a path decides who owns it. A task in an owned area is owned through it. A task in review waits in
its owner's **Needs you**, else its leads', else every member's, and **Mine** on the board includes the
tasks you own.

By default a change by another person's agent in a path you own is only a fact: your agents hear, once,
which task's agent changed which path, and nothing is stopped. Leads can mark path patterns where **the
owner decides**. There, another person's agent changes a file only with the owner's call. A session in
such a project starts with a note naming those patterns and whom to ask, and an edit without a call does
not run: the agent reads whose path it is and how to ask.

```sh
peer owner ask src/payments/fees.ts "add a refund fee field for ORD-9"
```

The call waits in the owner's **Needs you** with the task, its person, the paths and the reason. The owner
accepts or declines it, with a note if they like; a lead or an admin can decide for an owner who is away,
and nobody decides a call their own agent opened. The asking agent hears the answer once, with the note as
teammate text, and an idle agent is woken to hear it. After an acceptance the task's agents can change those
paths; after a decline they stay stopped. A call nobody answers expires after seven days, and its agent hears
that without being woken. `peer owner withdraw <id>` takes a call back. `peer owner` shows who owns the
task and the paths the session changed, the patterns that apply and the session's calls. From a terminal
outside an agent session it prints the project's owner map and records nothing.

A change in such a path also lands only with the owner's accepted call. A `git commit`, `git push`,
`gh pr create` or `gh pr merge` in the shell of an agent that changed one without a call does not run,
and the Hub refuses that agent's `peer review` and `peer done` for the same reason, which reaches agents
that have only Peer's tools too: they ask through their owner tool. The owner's own agents and people are
never stopped, and neither is a change in a path where the owner does not decide.

Peer goes by what it last read from the Hub: it reads again when the Hub says ownership changed, and every
30 seconds, so an answer can take a moment to count, and a Hub it cannot reach leaves it the last view.
Turn Ownership off in **Settings → This computer → Coordination & plugins**, or set `PEER_OWNERSHIP=off` for
the environment; its agents are then told nothing and stopped by nothing. A Hub without ownership shows no
owners and keeps every review in every member's **Needs you**.

Each project's **Team page**, opened from its Team tile in the sidebar, a task's menu or the project's Owners
settings, shows what the team's agents are doing: each person's agents, owned tasks and decisions waiting;
what needs a person, such as a call or a review waiting too long, a stopped push or a task with agents and no
owner; areas and tasks with their owners; the owner map; and who decided what in the last 30 days.
Colleagues' chats are counted, never listed, and requests and personal metrics never appear. If someone saves
the owner map first, you see what changed and your edits stay for you to review. On the phone the workspace
shows the same team read-only, and an owner decides a call from **Needs you**; deciding there needs the
phone's operate access.

## Needs you and Phone alerts

**Needs you** in the Tasks view of the sidebar on web and desktop counts, and the Overview's first column lists, your agents waiting for an approval or an answer (including on your other computer), team requests addressed to you, overlaps that need a decision and changed inputs blocking a handoff. The count and the column are the same list. An **Inputs changed** card opens its task context, which shows the versions the agent read and the current ones; the agent must update its inputs before handoff.

On mobile, open **Needs you** from the Home list or **Settings → Peer workspaces**. Review a request and choose a computer to **Accept request and start agent**. A computer explains anything blocking startup. Accepted requests remain under **Recently accepted**; acceptance does not confirm that an agent started. Check herdr before starting another agent when startup was not confirmed. For an unanswered overlap, use **Ask again** or **Close it yourself**. Answer a blocked herdr agent in herdr (mobile shows the command to attach a terminal on that computer); mobile can show its recent work.

**Phone alerts** in web **Settings → This computer → Coordination & plugins** and mobile **Settings → Peer workspaces**, under each computer, are off by default. Turn them on for one computer. Alerts carry titles only, never prompts, context text, notes, file paths or terminal output. They go through T3 Connect, Peer’s relay, with agent activity publishing enabled, and follow its notification and quiet switches. A direct connection alone cannot send them. Only the computer’s owner can change this setting. An alert opens its Needs-you item; an item already resolved says it has been handled.

### Shared resources and project patterns

An agent can reserve a named resource with `peer claim resource:deploy-staging --ttl 30m --intent "deploying"` and release it with `peer release resource:deploy-staging`. Leases last from one minute to eight hours; the default is 30 minutes. A refusal names the holder and expiry. Wait for release or expiry before trying again. `peer release` drops the agent's file claims and all its leased resources and patterns.

A project can give paths their own coordination policy, as path rules in **Settings → Projects →** the project **→ Coordination**. An exclusive pattern, such as `migrations/**`, reserves the whole matching scope for 30 minutes after the last edit; release it with `peer release "migrations/**"`. A lapsed or lost hold is no longer permission to rely on that scope. Automatic edit coordination follows Claude Code and Codex with Peer hooks.

Each project can set its own coordination policy; where it sets none, this computer's policy applies (**Settings → This computer → Coordination & plugins**). The project menu shows which one applies and where to change it, and an overlap and the coordination history say what decided each request: the project's policy, a path rule, or a computer's default. A request is marked amber when the project's path rules were not applied because the Hub does not serve them.

Held resources appear at the top of Tasks and in mobile's Peer workspaces screen. The holder's person, a project lead or a workspace admin can release them. A row checking expiry remains visible until the Hub confirms whether the lease was renewed.

## Recipes

Recipes are short procedures you ask your own agent to follow. Run `peer recipe` to list them, or `peer recipe catch-up` to print one. Coordinating agents hear which recipes are available once when their session starts. A recipe marked “reads only” reports what it found and asks before changing anything. A handoff saves the current state before releasing claims, then sends a request your teammate chooses to accept; it never prompts their agent.

With the Peer Mod in Claude Code, `/peer <recipe> [input]` schedules the recipe after the command returns. Hook-only Claude sessions and Codex use `peer recipe`; Codex also gets the `peer-recipes` skill with Peer's hooks. MCP clients can read the same recipes through their prompts and the recipe tool.

On a task's context page, **Ask your agent** sends a recipe to your own coordinating agent on that environment. Agents waiting for an answer are disabled until you answer them. Peer workspaces on mobile has the same action. A prompt typed into a herdr terminal cannot be recalled; a queued message in a Peer thread can be cancelled from that thread. If delivery is uncertain, check the agent before trying a new message; repeating the unchanged draft uses the same operation.

Settings → This computer → Coordination & plugins lists the available recipes and commands to copy. Turn **Agent recipes** off in Peer plugins to hide the controls, prompts and Codex skill. Recipes are advice: the agent still chooses each step and reports what happened.

## Metrics

Open **Tasks → Activity** of a project for its metrics, or open the project's metrics under **Settings → Projects** and the project.
Measurements come from the environment that runs your agents. Hook measurements cover Claude Code
with Peer Mod or Peer hooks and Codex with Peer hooks; each metric states its source and coverage.
Other agents have no hook measurements. **Not measured** means there is no supported measurement,
not a zero. Histograms show upper bounds, and token estimates are not money.

Local metrics start on. Team metrics need two choices: a workspace owner or admin enables **Team
metrics**, then each person chooses **Share this environment’s metrics**. Both start off. Until the
first, the Team choice reads **Team · off** with the reason beside it, and admins find the switch
under **Settings → Workspace → People**. Sharing starts today and sends content-free counts, timing
buckets and opaque task totals. Team device sums appear only with at least three contributing
computers. The Hub's coordination outcomes can appear with fewer. Shared-capacity spending uses its
own billing period; money per task is not measured.

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

## Catching up

**Since you were away** shows what changed when you return after more than an hour: task movements, merged pull requests, shared contexts, overlaps, knowledge decisions and your requests. Your own work and your agents’ changes are included. The device remembers when you left. On web and desktop it is what a project's **Activity** in Tasks shows first, one timeline with the newest change on top and a filter per kind; the Activity row counts it until you choose **Mark all seen**, and the same view shows the last 8 hours, 24 hours or 7 days. Mobile Peer workspaces shows it as a card you dismiss per project; pull requests open directly, while other entries are reference text.

Claude Code and Codex can run `peer catchup [--since 8h]`. The first call covers 8 hours; later calls in the same session say only what is new after the last successful answer. An explicit `--since` asks for that whole window. The reply fences team text as reference and points to `peer context` and `peer log` for details. A connection failure keeps the previous window for a retry.

The Hub covers at most 30 days and says when retained history starts later. A busy project may have less ledger history; the card reports that limit and any unavailable sources. Requests show only the ones you sent or received. Turn **Catch-up digest** off in Peer plugins to hide its controls; coordination history continues to record facts.
