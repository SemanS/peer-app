# Slack

Peer can ask you in Slack when one of your agents waits for you, and take your answer back to that
exact agent. Each agent session gets its own Slack thread. An approval, a question, or a turn the
agent finished and now waits on is a reply in that thread. You answer in the thread, and the agent
receives your words as if you had typed them in Peer, with nothing about Slack in them.

Only you can answer your agents. A teammate who replies in your agent's thread gets a private note,
and nothing reaches the agent. Slack stays off for everyone until they turn it on.

## Discuss shared work

An admin can turn on **Peer intercom** under **Channels, test and health**. Peer then opens a
separate Slack thread when two colleagues' agents have an overlap or a question between tasks,
or when two colleagues have contributed to a knowledge proposal or challenge. The opening message
mentions those colleagues, names the tasks and explains what needs discussing.

Both people need linked Slack accounts, **Ask me in Slack** enabled and **Thread in the project's
channel** selected. The project's Slack mode must also allow channel threads. Intercom currently
opens conversations for exactly two contributors; other findings stay in Peer's review queue.
Turning intercom off stops its posts and replies without
changing personal agent approvals.

Reply in an intercom thread to add a shared note of up to 600 characters. When both source agent sessions are known, their
tasks receive the note through Peer coordination, and the agents' replies appear in that same
Slack thread. A colleague's message is attributed to that colleague as shared context.

For an overlap, propose a resolution with `agree: keep the old API field until both clients migrate`.
The other colleague chooses **Confirm agreement** on that proposal. Peer closes the overlap and
keeps the agreement on both tasks. A changed overlap or a replacement proposal invalidates the old
confirmation. Ordinary replies, including “OK” or “agree”, do not close anything.

Knowledge threads are discussions. Keep, change, confirm or dismiss knowledge in Peer's Knowledge
review, which preserves the repository's review process. Peer updates the Slack thread when that
review changes the item's state.

## Connect Slack

Owners and admins connect a workspace's Slack app once, under **Settings → Workspace → Integrations → Slack
conversations**. Its status reads **Needs setup** with the step it is at, such as "Step 3 of 4: verify",
until Slack is connected. Slack sends replies to your Peer Hub, so the Hub must be reachable from the
internet.

Choose **Connect an existing Slack app** if you or a colleague already made a Peer app in Slack, or
**Create a new Slack app**. If you are not sure, open api.slack.com/apps first: when your Slack
workspace already lists an app called Peer, connect that one rather than making a second.

**Create a new Slack app** takes four steps. Setup reopens at the first one you have not finished, also
after you left for Slack, and says what is next.

1. **Create the app in Slack.** Choose **Open Slack**. Slack opens with Peer's settings already filled
   in: your Hub's two addresses, the bot events and the permissions Peer needs, which setup lists by what
   Peer does with them. Create the app, pick your Slack workspace in its dialog, then choose **I've done
   this**.
2. **Install it and copy two values.** In Slack, choose **Install App**, then **Install to** your
   workspace, then **Allow**. Copy the **Bot User OAuth Token** (it starts with `xoxb-`, under OAuth &
   Permissions) and the **Signing Secret** (under Basic Information) into Peer, and choose **Save both**.
   Peer stores them sealed and never shows them again; it only says **Stored** or **Missing**.
3. **Verify.** Peer asks Slack whose the values are and shows the Slack workspace and the bot before
   anything is used. If the workspace does not look like yours, choose **Paste other values**, or
   **Use** that workspace **anyway** if that is intended. If Slack rejected the token, copy it again;
   reinstalling the app makes a new one.
4. **Choose where agents post.** Pick a **Default channel**, or **Direct messages only**. Every project
   posts there unless you pick a channel for it later.

**Connect an existing Slack app** is one page: Peer shows the two addresses to compare with the app's
Event Subscriptions and Interactivity settings, the bot events and how many permissions a new app gets,
then takes the two values and saves and verifies them together. Nothing changes in Slack unless you
change it there.

Once Slack is connected, the card names the Slack workspace and the bot, where agents post, and the
members who linked their account, each with **Disconnect**. **Change** and **Channels, test and health**
open the pickers: a **Default channel**, and for each project a channel and how its agents post, **Thread
in the channel**, **Direct messages only** or **Off**. A project with **Named members** shows **Not set**,
and nothing is posted for it until you choose. Invite the Peer bot to a private channel first; Peer shows
"Invite @Peer to the channel." until you have. **Test** posts a message to the default channel; the page
also shows the last post, the last failure, how many members have linked their Slack account and how many
agents wait for an answer. It reads from the Hub when you open it and after each action; choose
**Refresh** to read it again.

Slack's settings belong to Peer, not to the workspace's configuration files, so applying a
workspace configuration never changes them.

## Link your account and turn it on

Every member does this once. Open **Settings → Me → Slack** and choose
**Link** under **Your Slack account**. Until the workspace has connected Slack, the page says so: an
admin finds **Open Slack setup**, and a member sees the admins' names and can copy a link to the
setup for them. On mobile, **Settings → Peer workspaces** has the same link and options, and shows
owners and admins the connection's state and problems. Connecting and changing it happen on web or
desktop.

- If a Slack user has your Peer address, Peer sends that user a direct message with a confirmation
  button. Press it.
- If not, Peer shows a one-time code. Send it to the Peer bot in a direct message in Slack.

Either expires after 15 minutes; **Link again** starts a new one. Choose **Refresh** when you are
done to see the link. Only people of the connected Slack workspace can link, and a Slack account
links to one member.

Then turn on **Ask me in Slack**. It stays off until you do, and needs a link. Choose:

- **Wait before posting**: how long an agent waits before Peer posts it. **Now**, **2 min**,
  **5 min** (the default) or **15 min**. If you answer in Peer first, nothing is posted.
- **Where**: **Thread in the project's channel**, or **Direct messages only**. The narrower of
  your choice and the project's applies.
- **What**: **Approvals**, **Questions**, **Finished turns** and **Blocked prompts**.

## Answer in Slack

The first post of a session names its task or thread, the project, you, the agent and the computer.
Each time the agent needs you it replies in that thread and mentions you.

- Reply in the thread, or press the buttons. An approval has buttons to approve or decline, and a
  question with up to five options has a button for each.
- Your reply gets an hourglass while Peer delivers it, and a check mark once the agent has it.
- A finished turn takes your next message: reply in the thread and the agent continues with your
  text. With several approvals open, use the buttons on the one you mean.
- The first answer closes the request. If you handled it in Peer first, or the agent moved on, the
  thread says "Not sent" and why, and nothing reaches the agent.
- Your answer waits for the computer that runs the agent, for up to 24 hours. If that computer is
  asleep, the thread says when the answer expires.

## What is never sent

Personal agent threads post your own agents' requests, and only after your delay. Titles are cut at 120
characters and questions at about 2,800, with "the rest is in Peer". Anything that looks like a
credential is replaced by `[redacted]`, and mentions and links in an agent's text are shown as text
and notify nobody. Personal agent threads deliver only your own replies. With intercom enabled,
agents' shared coordination notes also appear in the corresponding team discussion.

Slack cannot answer a permission prompt in a terminal. Peer posts it as a notice that names the
agent and the computer, without any terminal text or buttons, and a reply gets a private note that
the prompt can be answered only at the computer. Agents that run outside herdr and outside Peer
threads are not posted at all. See [Team agents](./peer-coordination.md).

## Turn it off

Switch **Ask me in Slack** off, or choose **Unlink**, to stop it for yourself. Your open requests in
Slack are withdrawn, and replies from that Slack account stop reaching your agents.

An admin turns a project off by setting its mode to **Off**, and the whole workspace off with
**Disconnect Slack from <workspace>**. Peer then stops posting and ignores replies from Slack. Remove
the Peer app in Slack as well; Peer cannot do that for you.

To stop one computer, its owner turns off the Slack plugin in
**Settings → This computer → Coordination & plugins**. That computer posts nothing and delivers nothing, and it
withdraws what it posted. While the workspace has not connected Slack, the plugin's row reads
**Waiting** and says whose setup it waits for.

If your Hub does not support Slack yet, Slack reads **Not available** and says "This Peer Hub has no Slack support yet; it
must be updated."
