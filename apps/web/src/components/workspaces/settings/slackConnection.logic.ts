/**
 * Slack as the workspace connects it, told in the status language wherever settings mention it
 * (the Hub's features, Settings › Overview): never "On" or "Off" while the setup is half done, but
 * Needs setup at the step the admin stands on. An admin reads the Hub's admin view, which knows the
 * steps; a member reads only whether the workspace connected Slack.
 */
import {
  SLACK_OLDER_HUB_LINE,
  slackOlderHub,
  slackSetupStep,
  type SlackSetupStep,
} from "@t3tools/client-runtime/peer/slack";
import type { PeerSlackAdminResult, PeerSlackMe } from "@t3tools/contracts";

import { CHECKING, type ConnectionView, type Fact } from "../../settings/connectionFacts";

/** How many steps an admin takes: create the app, store its values, verify them, choose a place. */
export const SLACK_STEP_COUNT = 4;

/** What the admin does at each step still to take, as the status line names it. */
const STEP: Readonly<Record<Exclude<SlackSetupStep, "create" | "connected">, ConnectionView>> = {
  secrets: {
    state: "setup",
    step: { n: 2, of: SLACK_STEP_COUNT, title: "install the app and store both values" },
  },
  verify: {
    state: "setup",
    step: { n: 3, of: SLACK_STEP_COUNT, title: "verify the stored token with Slack" },
  },
  channels: {
    state: "setup",
    step: { n: 4, of: SLACK_STEP_COUNT, title: "choose where agents post" },
  },
};

/** Why a read of Slack failed: a Hub without Slack is not available; anything else is a problem. */
function failed(message: string): ConnectionView {
  return slackOlderHub(message)
    ? { state: "unavailable", detail: SLACK_OLDER_HUB_LINE }
    : { state: "problem", detail: message };
}

/**
 * The admin's view of the connection. Nothing stored is Off (the workspace has not turned Slack
 * on); a problem Slack or a project's channel reports comes before any step; one stored value or
 * two unverified ones is a step to take; a verified app with a place to post is Connected, as of
 * its last verification.
 */
export function slackAdminConnection(
  fact: Fact<PeerSlackAdminResult>,
  workspaceName: string,
): ConnectionView {
  if (fact.kind === "loading") return CHECKING;
  if (fact.kind === "failed") return failed(fact.message);
  const admin = fact.value;
  const { step, problems } = slackSetupStep(admin);
  const [problem] = problems;
  if (problem !== undefined) {
    const project = admin.projects.find((candidate) => candidate.id === problem.project)?.name;
    return {
      state: "problem",
      detail: project === undefined ? problem.sentence : `${project}: ${problem.sentence}`,
    };
  }
  if (step === "create") {
    return { state: "off", detail: `Not turned on for ${workspaceName}.` };
  }
  if (step !== "connected") return STEP[step];
  const team = admin.team?.name ?? "Slack";
  const bot = admin.bot?.name;
  return {
    state: "connected",
    detail: bot === undefined || bot === "" ? team : `${team} as @${bot.replace(/^@/, "")}`,
    checkedAt: admin.verifiedAt ?? undefined,
  };
}

/**
 * A member's view: the workspace either connected Slack or has not. They cannot connect it, so
 * until it is done it is Off for them, not something to finish.
 */
export function slackMemberConnection(
  fact: Fact<PeerSlackMe>,
  workspaceName: string,
): ConnectionView {
  if (fact.kind === "loading") return CHECKING;
  if (fact.kind === "failed") return failed(fact.message);
  const me = fact.value;
  if (!me.connected) {
    return { state: "off", detail: `${workspaceName} hasn’t connected Slack. An admin does.` };
  }
  const team = me.team?.name ?? "Slack";
  const bot = me.bot?.name;
  return {
    state: "connected",
    detail: bot === undefined || bot === "" ? team : `${team} as @${bot.replace(/^@/, "")}`,
  };
}
