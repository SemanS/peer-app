# Slack

Peer can ask you in Slack when one of your agents waits for you, and take your answer back to that
exact agent. Each agent session gets its own Slack thread. An approval, a question, or a turn the
agent finished and now waits on is a reply in that thread. You answer in the thread, and the agent
receives your words as if you had typed them in Peer, with nothing about Slack in them.

Only you can answer your agents. A teammate who replies in your agent's thread gets a private note,
and nothing reaches the agent. Slack stays off for everyone until they turn it on.

## Connect Slack

Owners and admins connect a workspace's Slack app once. Open **Settings → Workspaces**, find
**Slack · your workspace**, and choose **Show Slack**.

1. Choose **Create the Slack app**. Slack opens with Peer's settings already filled in. Create the
   app, then install it to your Slack workspace. Slack sends replies to your Peer Hub, so the Hub
   must be reachable from the internet.
2. In your Slack app, copy the **Bot User OAuth Token** (it starts with `xoxb-`, under OAuth &
   Permissions) and the **Signing Secret** (under Basic Information). Paste them into **Bot token**
   and **Signing secret**, and choose **Save**. Peer stores them sealed and never shows them again;
   it only says **Stored** or **Missing**.
3. Choose **Verify**. Peer checks them with Slack and shows the Slack workspace and the bot, or says
   why Slack refused them, for example that the token was revoked. Store a new token and verify
   again.
4. Pick a **Default channel**. Every project posts there unless you pick a channel for it. For each
   project, choose how its agents post: **Thread in the channel**, **Direct messages only**, or
   **Off**. A project with **Named members** shows **Not set**, and nothing is posted for it until
   you choose. Invite the Peer bot to a private channel first; Peer shows "Invite @Peer to the
   channel." until you have.

**Test** posts a message to the default channel. The block also shows the last post, the last
failure, how many members have linked their Slack account and how many agents wait for an answer.
It reads from the Hub when you open it and after each action; choose **Refresh** to read it again.

Slack's settings belong to Peer, not to the workspace's configuration files, so applying a
workspace configuration never changes them.

## Link your account and turn it on

Every member does this once. Open **Slack · your workspace**, choose **Show Slack**, and choose
**Link** under **Your Slack account**. On mobile, **Settings → Peer workspaces** has the same link
and options, and shows owners and admins the connection's state and problems. Connecting and
changing it happen on web or desktop.

- If a Slack user has your Peer address, Peer sends that user a direct message with a confirmation
  button. Press it.
- If not, Peer shows a one-time code. Send it to the Peer bot in a direct message in Slack.

Either expires after 15 minutes; **Link again** starts a new one. Choose **Refresh** when you are
done to see the link. Only people of the connected Slack workspace can link, and a Slack account
links to one member.

Then turn on **Ask me in Slack**. It stays off until you do, and needs a link. Choose:

- **Delay**: how long an agent waits before Peer posts it. **Right away**, **After 2 minutes**,
  **After 5 minutes** (the default) or **After 15 minutes**. If you answer in Peer first, nothing is
  posted.
- **Post in**: **Thread in the project's channel**, or **Direct messages only**. The narrower of
  your choice and the project's applies.
- **What to post**: **Approvals**, **Questions**, **Finished turns** and **Blocked prompts**.

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

Peer posts only your own agents' requests, and only after your delay. Titles are cut at 120
characters and questions at about 2,800, with "the rest is in Peer". Anything that looks like a
credential is replaced by `[redacted]`, and mentions and links in an agent's text are shown as text
and notify nobody. Agents cannot reach Slack: no `peer` command mentions it, and the agent receives
only your words.

Slack cannot answer a permission prompt in a terminal. Peer posts it as a notice that names the
agent and the computer, without any terminal text or buttons, and a reply gets a private note that
the prompt can be answered only at the computer. Agents that run outside herdr and outside Peer
threads are not posted at all. See [Team agents](./peer-coordination.md).

## Turn it off

Switch **Ask me in Slack** off, or choose **Unlink**, to stop it for yourself. Your open requests in
Slack are withdrawn, and replies from that Slack account stop reaching your agents.

An admin turns a project off by setting its mode to **Off**, and the whole workspace off with
**Disconnect**. Peer then stops posting and ignores replies from Slack. Remove the Peer app in Slack
as well; Peer cannot do that for you.

To stop one computer, its owner turns off the Slack plugin in
**Settings → Workspaces → Peer plugins**. That computer posts nothing and delivers nothing, and it
withdraws what it posted.

If your Hub does not support Slack yet, the block says "This Peer Hub has no Slack support yet; it
must be updated."
