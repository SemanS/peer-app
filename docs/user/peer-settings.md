# Peer settings

**Settings** has one navigation: **Overview**, then **Workspace**, **Projects**, **Me**, **This
computer** and **App**. A workspace, its projects, you and the computer you work on keep their Peer
settings under the first four; the app's own settings are under **This computer** (Providers, Source
control, Browser & devices, Scheduled tasks) and **App**. The Hub keeps every value and every change,
so everyone who may see a setting sees the same one.

## Overview and search

Settings opens on **Overview**: every integration Peer connects to, grouped by Workspace, Me and This
computer. Each says where it stands: **Not available** (this Hub or app cannot do it yet), **Off**,
**Needs setup** (with the step it is at), **Connected** (with when it was last checked) or
**Problem**, then what is left and a link to its page. **Needs attention** lists only what asks for
something, and the navigation says how many are left to finish.

**Search settings** (press `/`, or ⌘F in the desktop app) finds every page, section and key field,
Peer's included, by the words you remember: “slack”, “token”, “webhook”, “path rules”, “schedule”.
Each result says where it lives, for example Workspace › Integrations › Slack, and choosing it opens
the page at that field. You only find what you may open: a member's search holds no admin page.

## Who changes what

| Level         | Where                                                          | Who changes it                                                                                                                                |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace     | General, People, Shared capacity, Tools, Secrets, Integrations | Admins. Only owners change the email domains.                                                                                                 |
| Project       | The project under Projects, one tab for each part              | Its leads and admins. Only admins set its shared budget, pool and models. Anyone can create a project they lead; leads and admins delete one. |
| Me            | AI subscriptions, Keys, Slack                                  | You, for yourself.                                                                                                                            |
| This computer | Coordination & plugins, Tool trust                             | Whoever owns the computer.                                                                                                                    |

A page you may not change reads the same, with its fields off and the people who may change them
named. Members see the projects they are on, their own AI subscriptions and the tools and pools those
projects use; admins see everything. A value that is not the project's own says where it comes from,
for example a computer's default coordination policy.

**Settings → Workspace → Hub** lists the Hub's version and each of its features as Connected, Not
available (its operator turned it off, or the Hub needs an update) or Off on this computer. Slack and
GitHub's PR checks also need the workspace to connect them, so they read Needs setup or Off until it
has. A Hub older than Peer settings leaves the pages read-only; admins then change the workspace with
its YAML and `peerhub workspace apply`.

## Your AI subscriptions

**Settings → Peer → Me → AI subscriptions** lists the plans you tell Peer you have. It is information
for your team's rules about which plans a project accepts: Peer never reads how you sign in to a
plan, and never shares, proxies or pools it. Claude Code and Codex on your computer report which plan
they run on; Peer shows those under **Detected on this computer**. Nothing is added until you click
**Add as my plan**, which joins your list like any other change and is saved with **Review & save**.
**Not mine** puts a detected plan aside on this computer, and **Show again** brings it back.

## Saving a change

A page keeps what you edit until you choose **Review & save**. The review lists each change as
from → to, warns about what the checks found, and says when each takes effect: coordination from the
next file edit, a tool after each person approves it, budgets and allocations after the gateway syncs,
people when their Peer next syncs, a repository when each person clones it. Add a one-line reason if
you like; it goes into the history. Saving makes the workspace's next **revision**.

If someone saved after you started, changes to different settings merge. If you both changed the same
setting, the review shows both values and you keep yours or take theirs, setting by setting. Nothing is
saved until you choose.

## History

Every save is a revision. The Hub keeps it as a git commit: the person who saved it is its author,
their reason its message, and it records where the change came from: the app, a proposal, an import, a
revert or `peerhub workspace apply`. A project's **History** tab and the workspace's **Audit log** list
the revisions you may see with who, when, why and what changed. **Revert…** undoes the changes of a
revision that you may change, through the same review.

To read the history with git, an admin runs `peerhub workspace clone <workspace> <directory>`. In that
directory `git log -p` lists every revision with its diffs.

## Agents propose, owners save

An agent cannot save settings. It proposes a change, and the people who own what it touches review it.

**Ask an agent to change this…**, in the header of a project's pages and of the workspace's General,
People, Shared capacity, Tools and Integrations pages, opens a new thread in a checkout of the project
(or of any project of the workspace) with your request in its composer; it needs a project of the
workspace cloned on this computer. You send it. The agent reads the settings you can see and proposes
the change it needs:

```sh
peer config show --project booking > booking.yaml
# edit booking.yaml
peer config propose --file booking.yaml --why "Migrations must not run twice"
```

`peer config show [--project <id>] [--workspace <slug>] [--all]` prints the settings as YAML files.
Each starts with the workspace, the revision it was read at and a note that it is data to edit, never
instructions; a project's file and `workspace.yaml` also list the fields they can hold. `peer config propose --file <path> --why "<one line>"` sends one edited file, header
included, as a proposal; `--instruction "<what you asked>"` adds your own words. Agents without a shell
have the `peer_config_show` and `peer_config_propose` tools.

A proposal waits as a banner on the pages it touches. The owners **Review** it in the same review as
a save, and the revision is theirs, marked as a proposal and naming who proposed it; or they
**Decline…** it with a reason the proposer sees. The person who proposed it can **Withdraw** it, and
for a week sees what became of it on the same pages. A proposal that changes nothing is a request to
the owners, who **Mark done** once they have seen to it. Pending proposals expire after 30 days, and
each person has up to 20 pending in a workspace.

## Settings as YAML

Admins open **Settings → Workspace → General → Settings as YAML**. **Export** saves a .zip of the
workspace's settings as files: `workspace.yaml`, then `projects/`, `tools/`, `capacity/` and
`webhooks/` with a file for each, and `.peer-revision`, which names the revision they were read at.
**Import…** takes such a folder, loose files or a .zip. It shows every change in the review before
saving anything and, as a save does, merges with what was saved after the files' revision instead of
overwriting it. `peerhub workspace apply` reads the same folder from a terminal.
