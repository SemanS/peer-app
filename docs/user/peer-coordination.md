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

Open a task in **Tasks** to read its current OpenSpec proposal and expand its checklist or design.
For a task with no chats yet, the first prompt is ready to edit on that page. Nothing starts until
you choose **Start agent**. The play button opens the same brief and prompt in a dialog. Expand
**Run configuration** to change the repository, Claude Code or Codex, or the starting branch.
If the source cannot be read, retry or explicitly choose to write a manual prompt; Peer does not
substitute the task title for the missing specification. A teammate's request keeps its own
instruction and the sender's words separate.

To connect a Peer task to an OpenSpec change, add `openspec/peer-tasks.json` in its repository:

```json
{
  "version": 1,
  "tasks": {
    "APP-12": "improve-task-summary"
  }
}
```

Use the task's ID or tracker key as the key, and its directory name under `openspec/changes/` as
the value. The change needs `proposal.md` and `tasks.md`; `design.md` is optional. Without a
mapping, Peer also recognizes a change directory whose name exactly matches the task ID or key,
ignoring case. Peer reads these files from the selected repository when you open the task or launch
dialog.

### A task keeps its own brief

When the repository proposes a change for a task, choose **Link to …**. Peer then saves the task's
brief (the proposal's goal and the checklist) in the Hub, where your teammates see the same brief.
From then on the saved link wins over `peer-tasks.json`, and the brief keeps the task startable
whatever happens to the change:

- **Edited change**: the agent gets the live change. The page lists what changed, and
  **Update from OpenSpec** replaces the saved brief when you choose it.
- **Archived change**: the agent starts from the saved brief. Close the task if its work is done,
  link another change, or keep the brief as the task's own.
- **Renamed or deleted change**: link another change, or keep the brief as the task's own.
- **Own brief**: a brief without a link. Edit its goal, checklist and notes on desktop, or link it
  to a change again.
- **Repository mapping disagrees**: when `peer-tasks.json` names another change than the saved
  link, Peer shows it and offers **Relink**; nothing changes on its own.

To update a whole project at once, ask your agent to "update my tasks from the current OpenSpec".
It shows a plan (link, refresh, close, create, relink or keep as own) and changes only the items
you confirm. Nothing is deleted. A Hub that does not keep briefs yet shows the live change and the
manual prompt as before.

Peer creates a separate git worktree and a `feature/` branch containing the task's issue key when it
has one; in a Jujutsu repository it creates a jj workspace and a bookmark of the same name instead. It assigns the agent to the task before sending the prompt. On mobile, open **Settings →
Peer workspaces**, select a task, then start the agent. Projects requiring approved commercial or
shared capacity use a Peer thread with an allowed provider instead of this local CLI launch.

If an agent needs a trust or approval answer, choose **Open herdr** in
**Settings → This computer → Coordination & plugins** (or attach to your own herdr) and answer there. If launch or prompt
delivery could not be confirmed, inspect herdr before retrying. The task checkout stays available so
an uncertain launch cannot discard work. Stopping an agent does not close its task or erase its saved
handoff context.

Once the task is done and its agent is closed, Peer removes the task's worktree (or jj workspace) by
itself, but only when nothing in it can be lost: no uncommitted or untracked file, every commit (or jj
change) pushed to a remote, no other repository inside it, and nothing ignored but folders a build makes
again, such as `node_modules/` or `dist/` (a `.env` or a `.venv/` keeps it). No program may still work
in it either, a terminal left open there included. Otherwise it keeps the folder, and while the agent is open its details say why. The branch or bookmark stays. Checkouts you made yourself, and those Peer made before this version, are
never removed.

Enable coordination in **Settings → This computer → Coordination & plugins**. Choose **Add to Claude Code**
to install Peer hooks in the enabled profiles on this computer. The installed Peer desktop app adds
its Codex plugin on first launch and moves older Peer hooks into it. Review the plugin's commands
for each listed Codex home, then choose **Trust these Peer hooks** to enable coordination. Codex lists
them under the **Peer** plugin in its hooks settings. Custom and managed profiles may use separate
homes; each needs installation and review before its sessions coordinate. **Add to Codex** also
installs the plugin on a server or restores one you removed. Removing or disabling the plugin in
Codex is respected when Peer restarts. Pausing coordination leaves it installed and idle.
The same controls are in **Peer workspaces** on mobile. Start a new agent session after adding or removing hooks.

An existing Peer Mod installation migrates to Claude Code hooks when the updated Peer starts.
Start a new Claude Code session after that update. Coordination no longer requires the Mod;
its panel and `/peer` command are replaced by the Peer app and `peer` shell commands.

Each herdr agent shows the coordination its running session actually supports:

- **A · action enforced:** an older Peer’s Claude Mod session checks tracked edits with the hub before they run.
- **B · hooks active:** a live session runs Peer hooks; blocking depends on the hook deadline.
- **B-mcp · advisory tools:** an agent can ask the Hub about paths before editing. Peer cannot stop its edits; follow each tool verdict.
- **C · observed after work:** Peer reports uncommitted paths after completed work. It cannot prevent
  overlaps or attribute every change to one agent.

An agent can keep the project's tasks for you: ask it to add, retitle, move to review or done, or
remove tasks, and it runs `peer task` (or the `peer_task` tool). It acts with your rights in the
workspace, so it can change only what you could change in **Tasks**. In a project that is only on
this computer, Peer leaves the agent out: there are no team tasks there yet. Ask the agent to share
the project with your workspace (`peer share`, or the `peer_share` tool), or choose **Share with <workspace>…** in the project button's menu.

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
The context page shows the input revisions saved with a publication after its agent stops or the
keeper changes. Later reads do not rewrite an older report's evidence. Earlier publications without
a saved input snapshot need revalidation; opening the page never marks inputs as read.

### Automatic conversation reports

Project and task reports update in the background while Peer runs. The conversation report includes
all stored conversations in the selected project, including archived chats and chats assigned to
tasks. It shows the latest request and agent reply from each conversation, with a link to the source.
A finished turn does not mean the work is complete. Terminal previews and conversations whose text
is unavailable are marked explicitly; importing a conversation includes only the history saved in Peer.

Report updates stay on the connected environment. They do not publish private chats to the Hub,
rewrite the agents' shared context, or count as an agent reading shared inputs. The saved shared
context and its recorded input evidence remain below the automatic report. The report's update time
changes when its content changes; checking for updates alone does not make an old report new.

### Use Peer from any editor

Editors and agents without Peer hooks coordinate through Peer's `peer_*` tools over MCP. To connect
one, open Settings → This computer → Coordination & plugins → **Use Peer from your editor** and
choose **Connect** next to the editor, or run `peer connect <client>` in a project folder (add
`--scope user` for every folder on this computer). Reload the editor afterwards. It works with the
folder it opens and needs Peer to be running. If the editor's settings file has comments, Peer leaves
it alone and shows the entry to paste. `peer disconnect <client>` removes it. Peer threads of Cursor,
Grok, OpenCode and Antigravity get the tools without this, and Claude Code and Codex use Peer hooks
instead. Approval modes may ask before these tools run.

### Peer without the app

Peer Core gives an editor or a terminal agent Peer's coordination on a computer where the Peer app
is not running or not installed. Its commands start with `peer core`. Where Peer has run before,
`peer` is already on your PATH; elsewhere install it with `npm i -g @webinson/peer-core` (Node 24 or
newer), or put `npx @webinson/peer-core` in front of each command below without the leading `peer`. Then:

1. `peer core login you@company.com` mails you a code; enter it to sign in. Peer joins the
   workspaces your address's domain admits, as the app would, and lists the invitations waiting
   for you: `peer core join <organization>` accepts one.
2. `peer core share ~/code/project` shares a folder with a workspace. The folder needs a git
   remote; add `--workspace <slug>` when you belong to more than one.
3. `peer core connect cursor` (or another editor) adds Peer's tools to the editor. Reload it
   afterwards. The editor starts Peer Core when it first needs it, so you do not have to.

`peer core status` shows whether the app or Peer Core coordinates this computer, who is signed
in, and which folders are shared. `peer core stop` stops Peer Core; it never stops the app.

Claude Code and Codex use Peer hooks rather than these tools. `peer core hooks install` adds them to
Claude Code (`--codex` adds Codex's too) and `peer core hooks remove` takes them out. While the app
runs, use Settings → This computer → Coordination & plugins instead; while Peer Core runs, stop it
first.
Codex asks you to approve Peer's hook commands once: the install prints them with the
`peer core hooks install --codex-approve <home> <review id>` line that approves them.

Only one of the two coordinates a computer at a time. When you start the Peer app, it takes over
and Peer Core steps aside; agents carry on after a short pause, as after a Peer restart. While Peer
Core runs, chats you started in the app on this computer show as unavailable to your team until the
app runs again. Sign in and out in the app while it runs: `peer core login` refuses then.

### Joining from an invitation

An invitation email carries one command: `npx @webinson/peer-core join <link>`, the link from the
email. It signs that address in when nobody is signed in on this computer (the code is mailed;
enter it when asked), joins the workspace and lists the projects the invitation named with their
repository and branch, the task waiting for you, and the `git clone` commands for the next step.
When someone else is signed in, it says who and stops; run `peer core logout` first. `peer core
join <organization>` still accepts an invitation by its name.

Add `--editor claude` (or `codex`, `cursor`, `vscode`, `zed` and the other editors `peer core
connect` knows) to connect your editor in the same step. Without it, `join` asks which of the
editors it finds you use, or, when it is not run in a terminal, prints `peer core hooks install`
and `peer core connect <client>` to run later.

You do not need to share or bind the clone. The first time an agent, `peer mcp` or `peer core
tasks` runs in a clone whose `origin` is the repository of one of your projects, Peer takes that
folder as the project's checkout and says so once ("Bound ~/work/webshop to example/webshop").
When two of your projects name the same repository, or the project already has a checkout on this
computer, it binds nothing and tells you to choose: `peer core bind ~/work/webshop --project
example/webshop` (add `--repository <id>` for a project with several repositories). While Peer
runs, `peer core bind` refuses; stop Peer Core first, or choose the folder in the app.

`peer core tasks` lists the tasks of the project you are in (or `--project <workspace/project>`, or
all of yours) that are not done, with status, area and owner, the invitation's task first.
`--open` shows only the tasks nobody owns, `--mine` yours. `peer core take <task>` makes you the
owner of a task nobody owns; a task someone owns is refused with their name. Both act as you,
with the Hub, and need neither the app nor Peer Core running.

### Returning to older work

The current context view brings together the reported result, attention and next step, with the
source revisions behind them. It does not turn an agent's report into independently verified facts.
The project overview includes tasks with no shared context yet. Work outside tasks keeps its own
shared context.

Agents can use `peer current` for their work or `peer current project-aggregate` for the project.
`peer archive --history true --topic "<words>"` also finds closed work; follow the returned cursor
with `--cursor` to continue. `peer evidence` lists declared input revisions and any missing coverage.
These commands are also available as MCP tools.

The view refreshes when the project's reported sources change. Use **Refresh current context** to
check again immediately, including when another environment has re-read an input. The assembly time
tells you when the displayed view was last collected; it is not a verification date.

Before a long pause, `peer inputs checkpoint` saves a reference point. After returning,
`peer inputs changes --since <checkpoint>` compares those revisions with their sources today;
use `--page` for further inputs. A missing original revision is shown as unavailable, so a current
document cannot pretend to explain a lost history. Private notes are not included in the checkpoint.

If an older installation lost its input evidence, read the required contexts again and run
`peer inputs recover "<what was reconstructed and what remains unknown>"`. This records an explicit
baseline, not proof that the content is correct. A transferred checkpoint carries references that
the receiving agent must re-read. Restarting an agent, clearing a notice or editing its summary
does not satisfy that requirement.

If a source was deliberately deleted and is no longer required, use
`peer inputs recover "<why this input is no longer needed>" --drop task:<id>`. The removal is recorded
with the new baseline; it does not mark the deleted source as read or verified.

Team findings remain pending until the keeper explicitly incorporates or dismisses their IDs with
a reason. `peer context decide '[{"id":"<finding>","status":"incorporated","reason":"<where it was addressed>"}]'`
publishes the keeper's current shared file and that decision together. A separate finding arriving
at the same time remains pending. Merely editing the file never acknowledges a finding.

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
For a project only on this computer it offers **Share with <workspace>…** instead: after you confirm,
the project moves under that workspace in the menu, its members see it and it gets team tasks.

The Tasks view starts with **Search** (the command palette), **Overview** (the Work board) and
**Needs you** with its count (see [Needs you](#needs-you-and-phone-alerts)). With one project,
**New task** adds a task, and **More** holds **Request a teammate…**, **Notify agents…** and **New
chat without a task**; a plugin that is turned off takes its item away. A new task needs only what
needs doing: an area and a tracker issue such as `KRK-812` are optional (a chat whose branch names
the issue joins the task), Enter creates it, **Create and start chat** also opens a chat on it, and
**Create more** keeps the window open for the next one. Below come what holds now in
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
input** is available for historical Claude Mod sessions that provided delivery proof. Hook-based
sessions report **Offered to adapter** until the agent explicitly acknowledges the announcement.
**Acknowledged** means the agent ran `peer announcements ack`. Agents can read and acknowledge announcements, but cannot post them.

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

## Project knowledge

A project's reviewed knowledge lives in its repository (kontext, `.ai/`). Agents see what it holds
when they start, and an entry that governs a file they change is named once. When the entry changes,
or someone disputes it, it is named again.

**Project knowledge** in a project's menu lists what agents found that the project may want to keep.
**Keep** stages it in `.ai/` for your next commit, with the tasks it came from as its sources. A
candidate that may say the same as a kept entry offers **Dismiss: already kept**. One that may
conflict with a kept entry lets you keep it as that entry's replacement. Candidates nobody found
again for 60 days fold under **Older** and come back when an agent finds them again.

**Challenged** lists entries that agents or people said no longer hold. An agent challenges an entry
with a line under For the team in its context, `- [against <entry id>] why`. Peer counts the agents
that said so on their own, and an agent that heard about the challenge first does not count. On a
challenged entry:

- **Second** adds your reason. To start a challenge yourself, open the entry under **Saved knowledge**,
  read its content, then choose **Review accuracy** and explain why it no longer holds.
- **Dismiss** says it still holds. If another agent challenges it on its own later, it opens again.
- **Write a replacement** has kontext draft a new entry from the reasons. You edit the draft, and
  Peer stages it so it supersedes the old entry. **Retire** stages the old entry as deprecated.
  Either one is resolved after a commit shows the change; until then it stays open as staged.
- **Resolve** closes a challenge whose entry was changed outside Peer, or is not in your checkout.

If an entry changed after it was challenged, read it again before you replace or retire it. Writing
a replacement needs kontext 0.3.0 with its model adapter on this computer. The phone offers
Second, Dismiss and Resolve. Challenges need a Peer Hub that serves them. With an older Hub, the
section does not appear.

### Drift

An entry has drifted when commits changed the code it governs but left the entry as it was. Peer
finds this from Git with kontext, without a model, and checks it twice:

- **At `peer review`.** Peer compares the task's checkout, including uncommitted changes, with where
  it left the default branch. The review stops and names each drifted entry with the files the
  agent changed. The agent settles each one: `kontext confirm <id>` if it still holds, which stages
  the entry with today's date as checked; an edit, replacement or retirement if it changed; or a
  challenge line under For the team, `- [against <id>] why`. Then it runs `peer review` again.
- **After work lands.** When the project's default branch moves on a computer where agents work
  on the project, Peer files a challenge for each entry that drifted in the new commits. The Hub
  keeps one per entry, however many computers file it. Under **Challenged** such an entry shows
  the files and commits that changed. **Still holds** stages the confirmation in your checkout,
  and the challenge resolves once a commit has the entry confirmed on or after the day it was
  raised. A drift challenge whose entry someone confirmed with kontext resolves the same way.

Drift needs kontext 0.4.0 and a Peer Hub that takes drift challenges. Without either, Peer skips
it and says nothing. Peer remembers in the repository where it last checked, so commits that
landed while it was not running are checked once agents work on the project again.

### Knowledge health

**Saved knowledge** says how far each entry can be trusted, by what checked it rather than when.
An entry is **Verified** when a person confirmed it, or its own check passed, at a commit that no
later commit on its paths has changed. A confirmation by an agent, or one of many at once, is
**Stamped, not checked**. An entry **Needs review** when commits touched its paths since, its check
failed or someone questioned it. Each entry names the proof and its commit, such as "Verified by its
test at a7450a5", and how many commits changed its paths since.

An entry that names a check (`verify:` in kontext) offers **Run check** in its detail. Peer runs the
command in your checkout and kontext records the outcome. **Review accuracy** lists the files and
commits that changed since the entry was verified, and **It still holds** takes an optional reason.
Peer also runs an entry's check by itself when the code it governs lands on the default branch and
when an agent runs `peer review`: a pass settles the question once it is committed, and a failure
shows the command and its output under **Review**. When an agent records a learning or decision
without a check, Peer points it at the test it just ran so it can add one.
These need a kontext with the verification ledger; with an older one, Peer shows the date an entry
was last confirmed.

### Flows

**Flows** reads the saved knowledge as processes instead of a list: each flow is one trail through
the entries, in the order a reader meets them along a process (an upload becoming a published
result, a release from tag to host), with the health of every step. Open a flow to follow its
trail; open a step to read its entry as under **Saved knowledge**. A step whose entry was
superseded, retired or never saved says so and opens nothing.

A flow is an architecture entry in the project's knowledge named `flow-…` (or tagged `flow`)
whose `## Trail` lists the entries as numbered `[[id]] — sentence` steps, with `###` headings for
stages. People write them, or an agent with kontext's `kontext-flows` skill does and you review
and commit. Flows change nothing about the entries they link.

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

Sessions started with Peer's Claude Code or Codex hooks carry a private credential.
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
The pull request list names each source and notes where GitHub and an owner's Peer differ; GitHub's
state is the one that counts. When an owner's Peer reports a merge that GitHub does not show, GitHub
may have missed it: an admin can redeliver the merge event from the repository's webhook settings
within three days, or a person can close the task. A closed PR that did not merge continues to
block an agent's completion.

An admin enables verification through **Settings → Workspace → Integrations**, using a
sealed workspace secret and a GitHub repository or organization webhook. GitHub must reach the
Hub's address. Personal-account repositories each need their own webhook. Agents inspect the same
facts with `peer delivery [task]`. Work outside github.com, including GitHub Enterprise Server, is
closed by a person. Mobile **Peer workspaces** shows the same badge and pull request list.

## Merge conflict forecast

Peer predicts textual merge conflicts between committed branches (bookmarks in a Jujutsu repository)
on this computer. Predictions are
advice: agents hear a changed prediction at their next step, and Tasks shows predicted conflicts and
task badges. Run `peer forecast` from an agent for details. Predictions never block editing or merging
and stay on the computer running Peer.

Git 2.38 or newer is required. Change **Merge conflict forecast** in **Settings → This computer → Coordination & plugins** to turn
it off or on. **Forecast teammates’ branches** is off by default; turning it on lets Peer fetch only
the named qualifying branches from origin, into a place of its own that never changes your
remote-tracking branches or jj's remote bookmarks. Mobile shows predictions and their state; change the
settings on web or desktop.

Predictions cannot see uncommitted edits, unpushed teammate branches, or builds that fail without a
textual merge conflict. Files with a `merge=union` rule or a custom merge driver are judged by Git’s
plain text merge, so the actual merge can differ.

## Jujutsu repositories

Peer works in a Jujutsu repository colocated with Git (one with both `.jj` and `.git`), as it does in
a Git checkout: it reports the nearest bookmark of an agent's working-copy change as its branch, so
sessions match their task and pull request; landing steps include jj's; agents started on a task get
a jj workspace; and the app says bookmark and workspace for those threads, also to teammates.

Each computer that runs agents in a jj repository needs jj 0.46.0 or newer (`brew install jj` on
macOS), your name and email in jj's own settings (`jj config set --user user.name "…"` and
`user.email`; jj does not read Git's, and refuses to push changes without them), and Git. A jj repository that is not colocated, or a computer whose jj is missing or older, shows
the project's checkout as unsupported with the reason; Peer then clones nothing into it and never
converts a repository. Windows is untested.

## Working on Jujutsu

In a colocated jj repository, agents can build on each other's work before it lands:

- **Start on a teammate's work.** When you start an agent on a task, **Start from** offers main first,
  then the other tasks' work in flight that has a bookmark. Peer fetches only that bookmark and starts
  the agent on top of it. When the agent pushes, Peer tells it the base its pull request needs.
- **Stay on the newest version.** An agent that builds on a teammate's change follows it: jj moves the
  agent's change when the teammate amends on the same computer, and Peer fetches the teammate's
  bookmark at the agent's tool steps when the change comes from another computer. The agent hears once
  what moved. Agents can also run `peer follow <task>`, `peer follow --stop`, or `peer follow` to see
  what they build on.
- **Teammates' changes stay read-only to agents.** Each agent workspace gets its own jj settings that
  make the changes other sessions made immutable, and Peer stops a jj command with `--ignore-immutable`
  in an agent session, naming whom to ask. Your own commands in a terminal are never stopped, and your
  own workspaces keep your settings. The switch is in **Settings → This computer → Coordination &
  plugins → Jujutsu workspaces**.
- **Edits are kept.** Peer takes a jj snapshot after every tool step of an agent, so a teammate's
  rewrite never overwrites an edit jj has not seen; a change left with two versions is merged at the
  next step, or shown with **Converge** when jj cannot choose.

The project's **Changes** page (it needs a Peer Hub with the `changes` feature) shows everyone's
changes in flight as one graph, with **Everyone** and **Mine**; reports carry facts, never code. A
task's page has a **Changes** section, and a change's review can show only what moved since you
marked a version reviewed. The mark stays on your computer; GitHub reviews are unchanged.

**Operations**, opened from the Changes page, lists this computer's jj operations. Undo an agent's step
there; the dialog names any later step it would also affect. **Integration preview** pairs every two
changes in flight on your computer and shows conflicts and merges that fail the check, with
**Build … on …** and **Resolve together…** on the computer where the later change's agent works, and
an ask to that person elsewhere. It is advice and never stops a push. In **Settings → This computer →
Coordination & plugins → Merge conflict forecast**, **Share my agents' work in progress** (off by
default) lets teammates' previews see your agents' unpushed work, which then sits on origin for
everyone who can read it, and **Check command** (for example `npm test`) runs on each clean merge, on
this computer, with teammates' code.

## Task dependencies

On a task, Claude Code and Codex agents can run `peer depends <task>...`, `peer depends --remove <task>...`, or `peer depends` to list both directions. Peer gives them a short reference at start and tells changes at their next step. It does not wake idle agents for dependencies, and no dependency blocks `peer review` or `peer done`. Other providers can use the same task controls through the app.

In Tasks, open a task's menu → Depends on, or its task context page, to add or remove a task from the same project. Blocked by marks an open or in-review dependency; closing or merging that work clears the mark. Cycles are refused. Removing a task clears its relationships, and a new task with the same key starts fresh. On mobile, open Settings → Peer workspaces and select a task to see and change Depends on and Needed by. Older Hubs show no dependency controls.

## Impact overlaps

Impact overlaps connect work that changes a symbol with other work whose changed code calls it.
Agents hear bounded advice at their next step, once per item and again if its change grows more
severe. These notices never block an edit or wake an idle agent. File overlaps continue to work
independently.

Install CodeGraph on the environment that runs the agents, then initialize each checkout you want
to use with `codegraph init <path>`. Task worktrees (jj workspaces) have their own indexes. Keep an index current by
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
- `peer status` ends with a line about the agent's plan.

If the Hub does not answer, `peer plan` ends uncertain: the plan may not be recorded. Peer sends the
newest declaration again when the Hub answers, and a newer one replaces it.

### Challenging a plan item

When an agent finds that something other plans build on does not hold, for example that `formatPrice`
takes euros and not cents, it says so before the code moves:

```text
peer plan challenge <item> --reason "<why>"     challenge a path or a symbol
peer plan challenge                             list the project's challenges
peer plan challenge --show <id>                 read one, with the works it meets
peer plan challenge --close <id> [--note "<text>"]
```

A challenge is advice, like a plan. Every other agent whose live plan uses, changes, may change or provides the
item hears it once at its next step, with the reason as teammate text and what its own plan does with the
item. Each agent decides whether its plan changes; Peer changes nothing and wakes nobody. An agent that
declares a plan later reads the open challenges it meets in the answer to `peer plan`. Challenging the same
item again replaces the reason, and the agents that heard it hear the new one. A project holds at most 20
open challenges, and a reason or note at most 400 characters.

The challenger, or an agent whose plan changes or provides the item, closes a challenge, with a note saying
how it was settled. The agents that heard the challenge hear the close once. A challenge nobody records,
re-states or closes for a day goes away without a word. On web, desktop and mobile, the Plans section of
each task whose plans a challenge meets lists it, read-only. A Hub that predates challenges refuses the command and keeps
plans working as before.

Only repository paths, symbol names and the contract lines an agent wrote go to the Hub. Source code, diffs
and line numbers stay on its computer. On web and desktop, a task's context page has a **Plans** section with
the live plans of its agents and the relations from that task's side, and the task's page counts them. Mobile
shows the same, read-only. People cannot edit a plan, and a plan never adds to **Needs you**.

Turn Plans off in **Settings → This computer → Coordination & plugins**, or in mobile Peer workspaces.
Turning it off withdraws this computer's plans and stops what agents hear about them. The environment
operator can force it off with `PEER_PLANS=off`; its controls then stay off with that reason. A Hub that does
not serve plans keeps Plans inactive until it is updated.

## Hand off for review

Task status is an administrative choice: people and their agents can set it through the task controls
or `peer task set <task> --status open|review|done`, with the person's task-edit rights. A review or done
status alone does not certify an agent's handoff. `peer review` and `peer done` run the guarded handoff
checks described below; setting status directly does not run those checks.

Run `peer review` after publishing your shared context and checking changed inputs. A review also
waits until the agent settles any project knowledge its change drifted from (see Drift). Peer stores a bounded package of the task’s shared context, the exact input versions read, overlap agreements and linked pull requests. It never copies a private conversation or an overlap’s discussion notes. Reviewers open the task’s context page to read each author’s package; `peer handoff <task>` reads it as a reference.

On a task with one of your threads, **Hand off for review** moves it into review; **Update handoff** refreshes its package. The first review response still confirms the transition even if publishing fails. A later context version is shown as a banner on the review, with **Compare** and **Open task context**, rather than changing the saved package.

Publishing defaults to **Pull request comment**. **Settings → This computer → Coordination & plugins** also offers **Not at all**, which keeps the package in Peer only. Each project can opt in to **Pull request description**. Publishing needs an active GitHub plugin, github.com and a signed-in GitHub CLI on the connected environment. Public repositories and repositories whose visibility cannot be checked receive only a pointer and counts. Other people’s pull requests are never edited.

**Withdraw** removes your package and your own published region and comments; it leaves the task’s status unchanged. If GitHub cannot be reached, the result names any manual cleanup. Withdraw before switching the plugin off to remove published blocks. Peer workspaces on mobile shows the package under the selected task and the target setting.

## Nothing lands unread

Before an agent's work lands, Peer gives it what its teammates have said to it. A step lands work
when it is a `git commit`, `git push`, `gh pr create` or `gh pr merge` in the agent's shell, or in a
Jujutsu repository a `jj commit`, `jj squash`, `jj new` or `jj git push`, alone or inside a longer command, or when the agent runs `peer review` or `peer done`. Peer knows the shell
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

Claude Code and Codex with Peer hooks are stopped in their shell steps. An agent that has
only Peer's tools is stopped at `peer review` and `peer done`. When Peer cannot answer within the
hook's deadline, the step goes on and the messages reach the agent at its next step; a push or pull
request Peer could not check in time is held until the agent tries again, as it always was.

## Agreements

When agents on two different tasks settle an overlap with `peer resolve "<what they agreed>"`, Peer keeps
the agreement on both tasks. Peer delivers it once to each later agent on either task, as quoted
teammate text, before that agent lands its work. An agreement such as "loyalty.js
divides by 100 once KRK-1 merges" therefore reaches whoever does that merge, even a new session. The
agents that settled it are not told it again, and `peer agreements` lists a task's agreements.

A task's context page lists its agreements with who settled them. **Close** (Handled or Not needed) ends
one, and **Reopen** brings back one a person closed. When one task lands (it is done, or its pull requests
are merged) and no agent works on the other, the agreement waits in Needs you for the people whose agents
made it, on the phone as a signal on the project and the task, and on the Team page. An agreement never
blocks work. It closes by itself when both tasks land, when a newer agreement between the same tasks
replaces it, or after 30 days. Turn **Agreements** off in Peer plugins to stop telling agents on this
computer.

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
`gh pr create`, `gh pr merge`, `jj commit`, `jj squash`, `jj new` or `jj git push` in the shell of an agent that changed one without a call does not run,
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

## Review sessions

A review session is an agent session that checks a task's work and changes nothing. To start one,
choose **Start a review** on a task's row, page or menu: Peer starts an agent on the task whose session
reviews it. To turn one of your own threads into a review session, or back, use **Set role: review** and
**Clear role** in the thread's menu. Your team sees the session as reviewing the task.

A review session may read files, run commands and tests, and file a test report. It may not:

- edit files: Peer denies the edit and tells the agent to report what it found instead;
- land work: a `git commit`, `git push`, `gh pr create` or `gh pr merge`, or their Jujutsu forms, does
  not run;
- hand the task over: the Hub refuses its `peer review` and `peer done`, and the task stays where it
  was. The task's author hands it over.

If a review session changes a file through the shell anyway, Peer tells it once to revert the change
and marks the session on the Team page; Peer reverts nothing itself.

An agent can make its own session a review session before it changes anything:

```sh
peer role review
```

It is refused once the session has changed files or holds claims; a review then needs a new session.
`peer role` prints the session's role. An agent cannot clear or change its own role: only its person
can, in Peer. The role ends with the session.

Peer stops edits and landing steps for Claude Code and Codex. A session that has only Peer's tools,
such as one in another editor, is labelled reviewing with **advisory**: Peer cannot stop its edits,
though the Hub still refuses its `peer review` and `peer done`. Turn **Review sessions** off in
**Settings → This computer → Coordination & plugins**; `peer role` is then refused and nothing is denied
for a role.

## Test reports

A test report says what a task's work was checked against: what passed, what failed, and what nobody
verified. An agent files one on its task:

```sh
peer tests mixed "Unit tests pass; the phone was not checked" \
  --pass "cargo test features::handoff" \
  --fail "vp test run checkout.test.ts" \
  --unverified "iPhone layout of the task page @slavo"
```

The full form is `peer tests pass|fail|mixed "<summary>" [--for <task>] [--pass "<text>"]...
[--fail "<text>"]... [--unverified "<text> [@<person>]"]...`. Each flag can repeat. `--for` names
another task of the same project; a session without a task needs it. A result that disagrees with the
items, such as `pass` with a failed item, is stored as `mixed`, and the reply says why. The reply names
the report's number and the unverified items that still need an owner.

An item that is exactly a shell command the session ran shows as **seen run by Peer**, with whether it
passed or failed and when; if Peer saw it fail, it shows that, whatever the agent reported. Every other
item shows as **author-reported**. Peer runs nothing to check an item.

Each person has one current report per task: filing again replaces it. A reviewer's report is kept
apart from the author's and is marked as filed in a review. A summary keeps 300 characters, an item
240, and a report 40 items; a longer report is shortened and says so. `peer tests show [<task>]` prints
a task's reports to an agent as reference from the team, not as instructions.

**Every unverified item needs an owner before an agent finishes the task.** An owner is a member of
the project who answers for the item; `@ana` is completed with the workspace's domain, and a name that is
not a member refuses the whole report. The agent can name owners when it files, or the task's owner, a
project lead or a workspace admin gives each item an owner on the task page, where you can also file,
replace or remove your own report. While the task's newest report lists an unverified item without an
owner, the Hub refuses an agent's `peer done` and names the items. `peer review` is never held back by a
report, and a person marking a task done is never stopped; the task page keeps showing the item.

The task's page, its row and the Team page show the newest result and how many items need an owner, and
the handoff package carries the newest report's result and counts. On the phone, reports are shown
read-only. Turn **Test reports** off in **Settings → This computer → Coordination & plugins**; `peer tests`
is then refused and `peer done` is judged as before.

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

Claude Code and Codex use `peer recipe <name> [input]`; Codex also gets the `peer-recipes` skill with Peer's hooks. MCP clients can read the same recipes through their prompts and the recipe tool.

On a task's context page, **Ask your agent** sends a recipe to your own coordinating agent on that environment. Agents waiting for an answer are disabled until you answer them. Peer workspaces on mobile has the same action. A prompt typed into a herdr terminal cannot be recalled; a queued message in a Peer thread can be cancelled from that thread. If delivery is uncertain, check the agent before trying a new message; repeating the unchanged draft uses the same operation.

Settings → This computer → Coordination & plugins lists the available recipes and commands to copy. Turn **Agent recipes** off in Peer plugins to hide the controls, prompts and Codex skill. Recipes are advice: the agent still chooses each step and reports what happened.

## Metrics

Open **Tasks → Activity** of a project for its metrics, or open the project's metrics under **Settings → Projects** and the project.
Measurements come from the environment that runs your agents. Hook measurements cover Claude Code
and Codex with Peer hooks; each metric states its source and coverage. Model-input receipts and
provider usage remain available for historical Claude Mod measurements.
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
