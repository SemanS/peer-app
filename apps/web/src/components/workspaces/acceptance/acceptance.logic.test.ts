import type {
  PeerAcceptanceSummary,
  PeerHubStatus,
  PeerTask,
  PeerTaskAcceptance,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { WorkProjectNode } from "../workTree.logic";
import { acceptanceCard, acceptanceFacts, teamTaskFacts } from "./acceptance.logic";

const ANA = "ana@acme.test";
const CYRIL = "cyril@acme.test";
const AT = "2026-10-28T10:00:00Z";
const clock = (at: string) => at.slice(11, 16);

const task = (id: string, status: PeerTask["status"]): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title: `Task ${id}`,
  status,
  createdBy: CYRIL,
  createdAt: AT,
  updatedAt: AT,
});
const TASKS = [task("vl7", "review"), task("vl8", "done"), task("vl9", "open")];

/** The status as Ana (a lead of Payments) or Cyril (a member) reads it. */
const statusFor = (
  role: "lead" | "member",
  accepted: ReadonlyArray<PeerAcceptanceSummary> = [],
  tasks: ReadonlyArray<PeerTask> = TASKS,
) =>
  ({
    email: role === "lead" ? ANA : CYRIL,
    acceptance: { accepted },
    workspaces: [
      {
        slug: "acme",
        role: "member",
        projects: [
          {
            project: {
              id: "pay",
              role,
              members: [
                { email: ANA, name: "Ana" },
                { email: CYRIL, name: "Cyril" },
              ],
            },
            work: { tasks },
          },
        ],
      },
    ],
  }) as unknown as PeerHubStatus;

const place = (taskId: string) => ({ workspace: "acme", project: "pay", task: taskId });
const summary = (taskId: string): PeerAcceptanceSummary => ({
  ...place(taskId),
  by: ANA,
  at: AT,
  statusThen: "review",
});

describe("acceptance on the task page", () => {
  it("a_lead_sees_accept_a_member_does_not", () => {
    const lead = acceptanceFacts(statusFor("lead"), place("vl7"))!;
    const member = acceptanceFacts(statusFor("member"), place("vl7"))!;
    expect(lead.actions).toEqual(["accept"]);
    expect(member.actions).toEqual([]);
    expect(acceptanceCard(lead, undefined, clock)).toMatchObject({
      heading: "In review · not accepted yet",
      actions: ["accept"],
    });
    // Cyril reads an accepted task's card as Ana does, without Withdraw.
    const accepted = statusFor("member", [summary("vl8")]);
    expect(
      acceptanceCard(acceptanceFacts(accepted, place("vl8"))!, undefined, clock),
    ).toMatchObject({ heading: "Accepted by Ana · 10:00", actions: [] });
    const asLead = statusFor("lead", [summary("vl8")]);
    expect(
      acceptanceCard(acceptanceFacts(asLead, place("vl8"))!, undefined, clock)?.actions,
    ).toEqual(["withdraw"]);
    // A connection without the grant to operate offers nothing, whoever reads it.
    expect(acceptanceFacts(statusFor("lead"), place("vl7"), false)!.actions).toEqual([]);
    // An open task is not delivered: nobody accepts it, and with nothing to say there is no card.
    const open = acceptanceFacts(statusFor("lead"), place("vl9"))!;
    expect(open.actions).toEqual([]);
    expect(acceptanceCard(open, undefined, clock)).toBeNull();
  });

  it("the_card_shows_history_and_withdrawal", () => {
    const facts = acceptanceFacts(statusFor("lead"), place("vl8"))!;
    const view: PeerTaskAcceptance = {
      ...place("vl8"),
      current: null,
      history: [
        { kind: "accepted", by: ANA, at: AT, note: "Checked on staging" },
        {
          kind: "withdrawn",
          by: ANA,
          at: "2026-10-28T11:00:00Z",
          note: "payment flow fails on refunds",
        },
      ],
    };
    const card = acceptanceCard(facts, view, clock)!;
    expect(card.heading).toBe("Done · not accepted");
    expect(card.actions).toEqual(["accept"]);
    expect(card.history).toEqual([
      expect.objectContaining({
        line: "Withdrawn by Ana · 11:00",
        note: "payment flow fails on refunds",
      }),
      expect.objectContaining({ line: "Accepted by Ana · 10:00", note: "Checked on staging" }),
    ]);

    // Reopened after the acceptance: it is kept, and said to be from before the reopening.
    const reopened = statusFor("lead", [summary("vl8")], [task("vl8", "open")]);
    const before = acceptanceCard(
      acceptanceFacts(reopened, place("vl8"))!,
      {
        ...place("vl8"),
        current: { by: ANA, at: AT, note: "Checked on staging", statusThen: "done" },
        history: [{ kind: "accepted", by: ANA, at: AT }],
      },
      clock,
    )!;
    expect(before.heading).toBe("Accepted by Ana · 10:00 · before reopening");
    expect(before.note).toBe("Checked on staging");
    expect(before.actions).toEqual(["withdraw"]);
  });

  it("done_without_acceptance_says_so", () => {
    const facts = acceptanceFacts(statusFor("member"), place("vl8"))!;
    expect(facts.state).toBe("not-accepted");
    expect(acceptanceCard(facts, undefined, clock)).toMatchObject({
      heading: "Done · not accepted",
      tone: "quiet",
      actions: [],
    });
    const project = {
      workspace: "acme",
      projectId: "pay",
      tasks: TASKS,
    } as unknown as WorkProjectNode;
    const fact = (status: PeerHubStatus, id: string) =>
      teamTaskFacts({ status, project, now: 0, task: { id, key: undefined, title: id } });
    expect(fact(statusFor("member"), "vl8")).toMatchObject({
      text: "done · not accepted",
      tone: "neutral",
    });
    expect(fact(statusFor("member", [summary("vl8")]), "vl8")).toMatchObject({
      text: "accepted by Ana",
      tone: "delivery",
    });
    // An open or reviewed task without acceptance gets no fact: the Team page shows it as before.
    expect(fact(statusFor("member"), "vl7")).toBeUndefined();
  });

  it("a_policy_acceptance_says_so_and_a_lead_may_withdraw_it", () => {
    const byPolicy = { ...summary("vl7"), via: "policy" as const };
    const facts = acceptanceFacts(statusFor("lead", [byPolicy]), place("vl7"))!;
    expect(acceptanceCard(facts, undefined, clock)).toMatchObject({
      heading: "Accepted by Ana via policy · 10:00",
      tone: "accepted",
      actions: ["withdraw"],
      hint: expect.stringContaining("review policy accepted the handoff"),
    });
    // A member reads the same card without the way to withdraw it.
    const member = acceptanceFacts(statusFor("member", [byPolicy]), place("vl7"))!;
    expect(acceptanceCard(member, undefined, clock)?.actions).toEqual([]);
  });
});
