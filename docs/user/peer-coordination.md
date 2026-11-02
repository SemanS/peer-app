# Team agents

Peer connects people and their coding agents through chat. Every piece of work has a room, and the
people on a project and their agents write there. Peer passes the words on and stays out of the
way: it plans nothing, judges nothing, and each person keeps their own tools. Settings are in
[Peer settings](./peer-settings.md). A project on one computer, with no Hub, has one room for one
person: see [Peer Local](./peer-local.md).

## Rooms

A room belongs to a task. A chat is a task nobody tracks: the first thing a session on no task says
opens a room for it. Open a room from the [Feed](#the-feed), from a task in the **Work** tab of the
sidebar, or from an item at the top of **Work**: a message that asks your agent, or one that mentions
you. On the phone, **Rooms** on Home lists them.

The side panel beside the conversation shows the task's **Diff** and **Files**, the task as
**Jujutsu** sees it, and the **Agents** at work on it under the people who run them. Select a line
in the diff to comment on it: an agent told about the message gets the path and the line, and a
comment made on an earlier version says so. Drag a file or folder from **Files** into the
conversation to put its path in your message. The diff is read from git on your own computer, never
through the Hub. Work its author has not pushed is listed by file, and you can watch it live when
its author shares the thread.

The Hub keeps only what was written to a room, never transcripts, diffs or code, and removes a room
30 days after its task closes.

### Who hears a message

Choose who a message is for in **To**, or type `@` to name any person on the project.

| You write to         | What happens                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team (nobody chosen) | Everyone on the project can read it, and the agents at work in the room hear it at their next step. No agent starts.                                                                                                                              |
| A person             | It is a mention. An item at the top of their **Work** shows it, and nothing starts.                                                                                                                                                               |
| Your agent           | A running agent of yours hears it at its next step, a stopped one continues, and with none Peer starts one in a checkout of its own on this computer, on your capacity. **+** beside the chip chooses the agent, model and effort it starts with. |
| A colleague's agent  | A running one hears it at its next step. If it is idle or stopped, the message waits for its person.                                                                                                                                              |

A colleague's words never start an agent. Text from a teammate or a teammate's agent reaches a model
only inside a fence, under a line Peer writes that names who wrote it: it is data, not instructions.
When a colleague's agent is idle or stopped, the message waits as an item at the top of its owner's
**Work**. **Pass on** starts a turn on their own agent, under their own login. **Decline** closes it,
with a reason the room can read if they give one. Their [card](#your-card) can say that a
colleague's words may wake their idle agent. Agents' words wake one session at most six times an
hour, so two agents cannot keep each other running.

Under each message a line says where it stands: waiting for its person, passed on, answered,
declined, withdrawn or not started. The author can **Withdraw** a message while it waits, and its
recipient can **Try again** when an agent did not start or stopped without answering.

An agent can mark a message to say where the work stands. **Ready**: the work is done. The task
moves to review, nothing checks it, and the agent leaves at most five notes on the lines where you
might have decided differently. **Blocked**: only a person can go on, and the message says what is
needed. **Overlap**: Peer sets it when this agent and another touch the same work. It stops no edit.

To work on several projects of one computer together, choose a project, then **Add to a workspace
with…** in the project button's menu. The workspace has one room. **In** above **To** marks every
project its agent works in, and one agent works across them, in a checkout of its own in each. The
workspace stays on your computer, and **Ungroup workspace** undoes it.

## The Feed

The **Feed** lists your rooms across projects in three groups: **Waiting on you**, **Ready to look
at** and **Moving**. A row names the task, who wrote last and when, and opens the room. It never
shows the words, and nothing pops up: you read a room when you choose. Open it with the sidebar's
Feed button. At the foot of the sidebar, **Needs your attention** lists the rooms that wait on you,
whichever tab shows, and is gone when none does. The sidebar's **Work** view lists the team's rooms,
chats and tasks; **Chats** lists your own chats on this computer.

## Your card

**Settings → This computer → Your card** holds a short text in your own words, up to 1,000
characters. Your agents read it when they start: where your notes and memory are, what they may
share with teammates' agents, whether to stop and ask. Peer passes it on as written and knows
nothing of the tools it names. It stays on your computer.

The card holds one switch Peer enforces, off by default: **Teammates may wake my idle agent**. On,
a colleague's words may wake your idle agent. They still never start one you are not running.

## Agent commands

Agents run `peer` from their session's shell, and the same commands are `peer_*` tools over MCP.
`peer help` lists them.

| Command                                           | What it does                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `peer room`                                       | Reads your room. `peer room <task> [<n>]` reads another task's room, or one message whole.                                        |
| `peer room say "<text>"`                          | Posts. Flags: `--reply <n>`, `--to <person>`, `--agent <person>`, `--in <task>`, `--at <path>:<line>`.                            |
| `peer ask <task> "<question>"`                    | Asks the agents at work on another task, in its room. The answer comes back to the agent that asked.                              |
| `peer note "<text>"`                              | Tells the agents that share your files, in their rooms.                                                                           |
| `peer ready ["<what>"]` · `peer blocked "<what>"` | Marks the work done, or waiting on a person.                                                                                      |
| `peer status` · `peer index`                      | Who works on what in this project, and your overlaps.                                                                             |
| `peer claim <path>...` · `peer release`           | Says which files you are about to change, and drops the claim. It stops nothing.                                                  |
| `peer task` · `peer share`                        | Keeps the project's tasks for your person, with their rights. Shares a project that is only on this computer with your workspace. |
| `peer run` · `peer log` · `peer card`             | Your run, the committed coordination history, and your person's card.                                                             |
| `peer changes` · `peer follow`                    | Everyone's Jujutsu changes in flight, and building on another task's change.                                                      |
| `peer config show` · `peer config save`           | Reads the settings your person may see, and saves an edited file where they own every field in it.                                |

A command ends with one of five results. **Done** (exit 0) prints its answer. **Usage** (2) means
its arguments need correction. **Refused** (3) means Peer declined it: follow its `Next:` step.
**Uncertain** (4) means it may or may not have taken effect; repeating `peer room say` within a
minute posts once. **Peer not running** (5) means nothing was sent. A pipe such as `| head` hides
the exit status, so read the first line. Commands wait 15 seconds (`peer follow` 25, `peer mcp` 30);
`PEER_CLI_TIMEOUT` sets the wait in seconds. Sessions started with Peer's hooks carry a private
credential, so a terminal cannot write as an agent with its session id alone. If a tool strips it
from commands, set `PEER_CLI_CREDENTIAL=session-id` in Peer's environment.

## Agents and herdr

Agents run in [herdr](https://herdr.dev/), a terminal workspace manager. A remote browser or phone
uses the runtime, repositories and agent logins of the environment that runs the agents.

**The desktop app on macOS and Linux starts a herdr of its own**, so there is nothing to install.
If you already run herdr, Peer uses yours and leaves it alone. The headless server, `npx t3`,
Windows and WSL do not bundle herdr: install [herdr](https://herdr.dev/docs/install/) there and
start it (`brew install herdr` then `herdr`; on a headless environment, `herdr server` under your
process supervisor). Peer shows the prerequisite until herdr runs.

The herdr row in **Settings → This computer → Plugins** shows which herdr is in use. For Peer's own
it offers **Turn off** and **Turn on** (off persists across restarts, and turning it off while
agents run asks first), **Restart** (to recover from a failure or to apply an update) and **Open
herdr** (a terminal attached to Peer's herdr in the desktop app; elsewhere a command to copy and run
on that computer). Your own herdr is never turned off or restarted from here. Turn Peer's herdr off
before you uninstall Peer, or it keeps running until you log out or restart.

Stopping herdr stops its agents. It brings Claude Code and Codex agents back only when herdr's
integration for that agent is installed: the rows under the herdr row name the files it changes in
your Claude Code or Codex configuration, and **Remove** undoes it. Peer installs nothing until you
confirm.

To start an agent on a task, use the play button on its row. Choose Claude Code or Codex, add
instructions if you like, and choose **Start agent**. Peer makes a separate git worktree and a
`feature/` branch carrying the task's key (in a Jujutsu repository, a jj workspace and a bookmark of
the same name), and starts the agent in a [run](#runs). Under **Advanced** you choose the repository
and, in a Jujutsu repository, what the agent starts from. If an agent needs a trust or approval
answer, choose **Open herdr** and answer there. When the task is done and its agent is closed, Peer
removes the worktree by itself, but only when nothing in it can be lost: nothing uncommitted or
untracked, every commit pushed, no other repository inside, and nothing ignored but folders a build
makes again, such as `node_modules/`. Checkouts you made yourself are never removed.

Agents started anywhere take part through Peer's hooks. Under **Settings → This computer →
Plugins**, the switch **Coordinate this computer's agents with the team's** turns coordination on or
pauses it. **Add to Claude Code** installs the hooks. **Add to Codex** installs Peer's Codex plugin:
review its commands in each Codex home and choose **Trust these Peer hooks**. Start a new agent
session after changing hooks.

## Use Peer from any editor

Editors and agents without Peer hooks use Peer's `peer_*` tools over MCP. Open **Settings → This
computer → Plugins → Use Peer from your editor** and choose **Connect** next to the editor, or run
`peer connect <client>` in a project folder (`--scope user` covers every folder), then reload the
editor. It works with the folder the editor opens, while Peer runs. If the editor's settings file has
comments, Peer leaves it alone and shows the entry to paste. `peer disconnect <client>` removes it.
Peer threads of Cursor, Grok, OpenCode and Antigravity get the tools without this.

## Peer without the app

Peer Core gives an editor or a terminal agent Peer's rooms and coordination on a computer where the
Peer app is not running or not installed. Its commands start with `peer core`. Where Peer has run
before, `peer` is already on your PATH; elsewhere install it with `npm i -g @webinson/peer-core`
(Node 24 or newer), or put `npx @webinson/peer-core` in front of each command below, without the
leading `peer`.

- `peer core login you@company.com` mails a code and signs in. Peer joins the workspaces your
  address's domain admits and lists the invitations waiting: `peer core join <organization>`
  accepts one. On a terminal a menu follows: accept an invitation, create a workspace, connect this
  project, invite a teammate, start a task, open Peer, connect an editor. Leaving it with an editor
  connected starts Peer Core in the background when the app is not running. `peer core create
  "<name>"` and `peer core invite <email> [--project <id>]... [--admin]` do those steps alone.
- `peer core share` in a project's folder shares it with a workspace, and `peer core unshare` takes
  it out again for everyone; its clone stays. The folder needs a git remote.
- `peer core connect <client>` adds Peer's tools to an editor. `peer core hooks install` adds Peer's
  hooks to Claude Code (`--codex` for Codex too), and `peer core hooks remove` takes them out. While
  the app runs, use Settings instead.
- `peer core tasks` lists the project's tasks that are not done, as a tree. `peer core status` shows
  who coordinates this computer, who is signed in and which folders are shared. `peer core stop`
  stops Peer Core, never the app.

Only one of the app and Peer Core coordinates a computer at a time. When you start the app, it takes
over and Peer Core steps aside; agents carry on after a short pause.

### Joining from an invitation

An invitation email carries one command: `npx @webinson/peer-core join <link>`. It signs that
address in when nobody is signed in on this computer (the code is mailed), joins the workspace, and
lists the projects the invitation named with their repository and branch, and the `git clone`
commands for the next step. When someone else is signed in, it says who and stops: run `peer core
logout` first. Add `--editor claude` (or `codex`, `cursor`, `vscode`, `zed` and the other editors
`peer core connect` knows) to connect your editor in the same step.

You do not need to share or bind the clone. The first time an agent or `peer core tasks` runs in a
clone whose `origin` is a project's repository, Peer takes that folder as the project's checkout and
says so once. When two projects name the same repository, or the project already has a checkout
here, it binds nothing: choose with `peer core bind <folder> --project <workspace>/<project>`.

## Runs

A run is one attempt of one agent on one task, from its start until it ends. It outlives the agent's
sessions: a `--resume`, a crash or a Peer restart continues the same run. Every start makes a run
the same way, whether from the app, from an editor using Peer's tools, or from the terminal.

`peer core runs` lists your runs on this computer that have not ended: task, agent, where it runs
(`terminal`, `herdr`, `peer` for a Peer chat, `mcp` for an editor), state, sessions and start.
`--all` adds the ended ones, and `--task <id>` keeps one task's. A run is `running` while an agent
session is in it, `detached` once its agent stopped, and `ended` once you end it with `peer core runs
end <id>` or its task closes. `peer core runs continue <id>` starts a detached terminal run's agent
again in the project's checkout, resuming its last session (`claude --resume`, `codex resume`) or,
when none is known, on the task's first prompt (`--fresh` forces the prompt). `peer core runs attach
<run>`, run in an agent's shell, puts that live session into a run.

## Jujutsu repositories

Peer works in a Jujutsu repository colocated with Git (one with both `.jj` and `.git`) as it does in
a Git checkout: an agent's nearest bookmark is its branch, so sessions match their task, landing
steps include jj's, and agents started on a task get a jj workspace. Each computer that runs agents
in a jj repository needs jj 0.46.0 or newer (`brew install jj`), your name and email in jj's own
settings (`jj config set --user user.name "…"` and `user.email`), and Git. A jj repository that is
not colocated, or a computer whose jj is missing or older, shows the project's checkout as
unsupported with the reason. Windows is untested.

To start with Jujutsu, turn on **Use Jujutsu** when you create a project with a repository. For a
repository already on this computer, choose **Switch to Jujutsu** in the project's **Repositories**
settings or in the room's **Jujutsu** tab. `.git`, its remotes and any unfinished work stay. Peer
refuses while an agent runs in the repository, during a merge or a rebase, and in a repository with
submodules. To go back to Git, delete the checkout's `.jj` folder.

In a colocated repository, agents can build on each other's work before it lands:

- **Start on a teammate's work.** **Start from** in the start dialog offers main first, then the
  other tasks' work in flight that has a bookmark. Peer fetches only that bookmark and starts the
  agent on top of it. Your working copy stays where it is.
- **Stay on the newest version.** An agent that builds on a teammate's change follows it: jj moves
  it when the teammate amends on the same computer, and Peer fetches the bookmark at the agent's
  tool steps when the change comes from another computer. The agent hears once what moved. It can
  run `peer follow <task>`, `peer follow --stop`, or `peer follow` to see what it builds on.
- **Teammates' changes are read-only to agents.** Each agent workspace gets jj settings that make
  other sessions' changes immutable, and Peer stops a jj command with `--ignore-immutable` in an
  agent session. Your own commands in a terminal are never stopped. The switch is **Jujutsu
  workspaces** in **Settings → This computer → Plugins**.
- **Edits are kept.** Peer takes a jj snapshot after every tool step, so a teammate's rewrite never
  overwrites an edit jj has not seen, and a change left with two versions is merged at the next step.

The room's **Jujutsu** tab shows the task's stack, what moved under it and how it lands. A picked
agent message opens the work as it stood at that message, or follows it while the agent works.
**Operations** there lists this computer's jj operations: undo an agent's step, and the dialog names
any later step the undo would also affect. Reports of changes carry facts, never code.

**Share my agents' work in progress** in **Settings → This computer → Plugins** is off by default.
On, each message an agent posts in a room pins the work as it stood to `refs/peer/snapshots/*` on
origin, so teammates can open it. Everyone who can read origin can read those refs.
