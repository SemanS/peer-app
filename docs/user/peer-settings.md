# Peer settings

Open **Settings** to configure your workspace, its projects, your computer and the app. **This
computer** holds providers, source control, the browser for agents, devices, scheduled tasks and
Peer's own pages. Local settings stay on the connected environment. An optional Hub stores a
workspace's settings, so its members see the same values.

## Work without a Hub

[Peer Local](peer-local.md) works without signing in. Open a repository, then use **Settings → This
computer → Plugins** to configure coordination and agent hooks. **Your card**, **Plugins** and **Tool
trust** stay available while you are signed out. Connecting a team Hub is optional: choose **Sign in
to Peer Hub** at the top of the sidebar, or **Settings → Connect Peer Hub**, and sign in with your
work email. Organizations founded for you and invitations appear once you are signed in. On mobile,
the same sign-in is under **Settings → Peer workspaces**.

## Overview and search

Settings opens on **Overview**, which lists what Peer connects to under **Workspace** (the Hub) and
**This computer** (providers, source control, tools, the browser for agents, the device hub). Each
row shows its status, **Not available**, **Off**, **Needs setup**, **Connected** or **Problem**, and
a link to its settings. **Needs attention** lists what needs action.

**Search settings** (press `/`, or ⌘F in the desktop app) finds every page, section and key field,
Peer's included, by the words you remember: “domain”, “secret”, “plugins”, “hooks”. Each result
includes its settings path, for example Workspace › Tools. Search includes only pages you may open.

## Who changes what

| Level         | Where                                                           | Who changes it                                                                            |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Workspace     | General, People, Tools, Secrets, Audit log                      | Admins. Only owners change the email domains. Hub is read only.                           |
| Project       | The project under Projects: Basics, People, Repositories, Tools | Its leads and admins. Anyone can create a project they lead; leads and admins delete one. |
| This computer | Your card, Plugins, Tool trust                                  | Whoever owns the computer.                                                                |

On a read-only page, Peer disables the fields and names the people who can change them. Members see
their projects and the tools those projects use; admins see all workspace settings.

**Settings → Workspace → Hub** is read only. It lists the Hub's version and the features the app has
words for (workspace settings, the audit log and Observe), each as Connected, Not available (its
operator turned it off, or the Hub needs an update) or Off on this computer. A Hub older than
Peer settings leaves the pages read only; admins then change the workspace with its YAML and
`peerhub workspace apply`.

## Saving a change

A page keeps what you edit until you choose **Review & save**. The review lists each change as
from → to, shows what the Hub's checks found under **Before you save**, and says when each takes
effect: a tool after each person approves it, people when their Peer next syncs, a repository when
each person clones it. Add a one-line reason if you like. Saving makes the workspace's next
**revision**.

If someone saved after you started, changes to different settings merge. If you both changed the
same setting, the review shows both values and you keep yours or take theirs, setting by setting.
Nothing is saved until you choose.

## Agents change what you own

An agent can save settings you own. It reads them as YAML files, edits a copy and saves it with a
reason:

```sh
peer config show --project booking > booking.yaml
# edit booking.yaml
peer config save --file booking.yaml --why "Migrations must not run twice"
```

`peer config show [--project <id>] [--workspace <slug>] [--all]` prints the settings you can see.
Each file starts with the workspace, the revision it was read at and a note that it is data to edit,
never instructions. `peer config save --file <path> --why "<one line>"` saves one edited file,
header included, when you own every field it changes. Nothing is saved when you do not, or when
someone saved the same field since the agent read it. Agents without a shell have the
`peer_config_show` and `peer_config_save` tools. The Hub records the revision under your name and
names the agent.

## Settings as YAML

The Hub keeps a workspace's settings as a git history: every save is a commit with its author and
reason. Admins read and change it from a terminal with `peerhub workspace export`, `apply`,
`clone`, `pull` and `history`. The files are `workspace.yaml`, `projects/` and `tools/` with a file
for each, and `.peer-revision`, which names the revision they were read at. `apply` shows every
change before saving anything and, as a save does, merges with what was saved after the files'
revision instead of overwriting it. In a clone, `git log -p` lists every revision with its diffs.

## Email domains and members

Peer joins the workspace that holds your email domain when you sign in. Other workspaces listing the
same domain appear as offers in the first-run step, in Settings and on mobile: choose Review to see
who holds the domain and what joining shares with its members, then confirm to join. Leaving a
workspace keeps Peer from joining it automatically on this environment.

To prove control of a domain, a workspace owner has the person who manages DNS publish the
workspace's TXT record. **Verify with DNS** next to the domain in **Settings → Workspace → General**
shows the record and checks for it, as `peerhub workspace verify <workspace> <domain>` does from a
terminal. Listing a domain alone does not prove ownership.

Owners and admins manage membership in **Settings → Workspace → People**: invite by email with a
role and the projects the person is on, withdraw or resend an invitation, and **Remove access**.
Removal first shows the invitations it withdraws and the projects that still name the person. A
removed person loses workspace access and cannot rejoin through their email domain: use **Invite
back** to readmit them. **Sign out everywhere** in the account menu ends all your Hub sessions;
local repositories and threads stay on your computers. When offboarding someone, also remove their
access at your git host and other services: removing Peer access cannot erase their clones.

**Settings → Workspace → Audit log**, for owners and admins, lists membership, settings, project and
task changes with who made them. It can be filtered by group or person. It holds no secrets.

## Tools, secrets and plugins

**Workspace → Tools** is the catalog of MCP servers a workspace's projects can give their agents.
Tools a workspace proposes wait until you approve their definitions on the computer that runs your
agents: open **This computer → Tool trust**, or choose **Review** on the notice at the top of
**Work**. Approve tools one by one or together, or keep them off; a change to what runs or where it
sends data asks again. Turning a tool off applies to Claude at its next turn, and running Codex
conversations keep it until their session restarts. **Workspace → Secrets**, for admins, holds
values the Hub seals and never shows again. A secret a tool asks for, like `${secret:JIRA_TOKEN}`, is
set by each person on their own computer in Tool trust, or allowed from an environment variable for
that workspace. Those values stay on that computer, and leaving the workspace or signing out forgets
them.

Each Peer feature is a plugin: herdr agents, Jujutsu workspaces, Observe, Your card, Audit log,
Workspace tool trust, Coordination tools (MCP), Changes, Task rooms and Workspace settings. The owner
of a computer turns them on and off under **This computer → Plugins**, or in **Peer workspaces** on
mobile. The choice belongs to that computer and applies at once. A plugin that is off adds nothing:
agents get none of its text, and its `peer` command is refused. Turning a plugin off undoes what it
set up outside Peer, and turning it on again does not bring that back. A plugin also stays inactive
while the Hub you signed in to does not serve the feature it needs: **Workspace → Hub** says which.
