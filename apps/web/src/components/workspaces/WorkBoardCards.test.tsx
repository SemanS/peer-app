import { ALL_PROJECTS, taskCards, type TaskCard } from "@t3tools/client-runtime/peer/work";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ANA,
  BOB,
  CYRIL,
  EVA,
  NOW,
  ownerCall,
  ownerCallItem,
  statusFor,
  workProject,
  type Looking,
} from "./ownership/ownership.testkit";
import { NeedCardView, TaskCardView, type CardActions, type OwnerCallCard } from "./WorkBoardCards";
import type { WorkHere } from "./marks";

const here: WorkHere = { providers: new Map(), label: null, machine: "laptop" };
const actions = {
  openTarget: vi.fn(),
  openContext: vi.fn(),
  openOverlap: vi.fn(),
  openRequest: vi.fn(),
  openOwnerCall: vi.fn(),
  withdrawOwnerCall: vi.fn(),
} satisfies CardActions;

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
const buttons = () => renderer!.root.findAllByType("button");
const button = (label: string) => buttons().find((candidate) => words(candidate) === label);

/** The board's cards for `email`, with a pending call (or none) under Needs you. */
function board(
  email: string,
  looking: Looking = {},
  call: ReturnType<typeof ownerCall> | null = ownerCall(),
  item = {},
) {
  const project = workProject(email, looking);
  return {
    project,
    cards: taskCards([project], {
      scope: ALL_PROJECTS,
      mine: false,
      query: "",
      needs: call === null ? [] : [ownerCallItem(call, item)],
      me: email,
    }),
  };
}

const taskCard = (cards: ReadonlyArray<TaskCard>, key: string) => {
  const found = cards.find((card) => card.kind === "task" && card.task.key === key);
  if (found?.kind !== "task") throw new Error(`no card ${key}`);
  return found;
};
const callCard = (cards: ReadonlyArray<TaskCard>): OwnerCallCard => {
  const found = cards.find((card) => card.kind === "owner-call");
  if (found?.kind !== "owner-call") throw new Error("no owner's call card");
  return found;
};

async function showCall(email: string, looking: Looking = {}, item = {}, call = ownerCall()) {
  const { cards } = board(email, looking, call, item);
  await act(async () => {
    renderer = create(
      <NeedCardView
        card={callCard(cards)}
        status={statusFor(email, looking)}
        showProject={false}
        now={NOW}
        actions={actions}
      />,
    );
  });
}

async function showTask(email: string, key: string, looking: Looking = {}) {
  const { cards } = board(email, looking, null);
  await act(async () => {
    renderer = create(
      <TaskCardView
        card={taskCard(cards, key)}
        here={here}
        status={statusFor(email, looking)}
        showProject={false}
        actions={actions}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const action of Object.values(actions)) action.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("an owner's call in Needs you", () => {
  it("tells the owner who asks to change what, why, and offers Accept… and Decline…", async () => {
    await showCall(ANA);
    const said = words(renderer!.root);
    expect(said).toContain("Bob's agent asks to change your path");
    expect(said).toContain("VL9");
    expect(said).toContain("Refund fee field");
    expect(said).toContain("src/payments/fees.ts");
    expect(said).toContain("“add a refund fee field”");
    expect(said).toContain("Bob's agent's words · 40 min ago · expires in 6 days");
    expect(buttons().map(words)).toEqual(["Accept…", "Decline…"]);
  });

  it("opens the dialog of the decision the person chose", async () => {
    await showCall(ANA);
    await act(async () => button("Accept…")!.props.onClick());
    await act(async () => button("Decline…")!.props.onClick());
    expect(actions.openOwnerCall.mock.calls.map(([, decision]) => decision)).toEqual([
      "accept",
      "decline",
    ]);
    expect(actions.openOwnerCall.mock.calls[0]![0].item.call.id).toBe("call-1");
  });

  it("offers a lead the decision for an owner who left, in words that name the owner", async () => {
    const left = {
      members: [
        { email: BOB, name: "Bob" },
        { email: CYRIL, name: "Cyril" },
        { email: EVA, name: "Eva" },
      ],
    };
    await showCall(EVA, left, {
      title: "Bob's agent asks Ana to change their path",
      owner: "Ana",
      onBehalf: true,
    });
    const said = words(renderer!.root);
    expect(said).toContain("Bob's agent asks Ana to change their path");
    expect(said).toContain(
      "As a lead you can decide on Ana's behalf. The record says you decided for Ana.",
    );
    expect(buttons().map(words)).toEqual(["Accept for Ana…", "Decline for Ana…"]);
  });

  it("does not let a person decide their own agent's call: Accept is disabled and says why, and they can take it back", async () => {
    await showCall(BOB);
    expect(words(renderer!.root)).toContain("Your agent asked Ana to change their path");
    expect(words(renderer!.root)).toContain(
      "You can't decide a call your own agent opened. Ana decides it, or another lead or an admin.",
    );
    expect(buttons().map(words)).toEqual(["Accept", "Withdraw"]);
    expect(button("Accept")!.props.disabled).toBe(true);
    await act(async () => button("Withdraw")!.props.onClick());
    expect(actions.withdrawOwnerCall).toHaveBeenCalledTimes(1);
    expect(actions.openOwnerCall).not.toHaveBeenCalled();
  });

  it("offers nothing for a call that is no longer pending", async () => {
    await showCall(ANA, {}, {}, ownerCall({ state: "accepted" }));
    expect(words(renderer!.root)).toContain("This call is no longer pending.");
    expect(buttons()).toEqual([]);
  });
});

describe("the owner on a task's card", () => {
  it("says who owns the task, and you when it is you", async () => {
    await showTask(CYRIL, "VL9");
    expect(words(renderer!.root)).toContain("Owner Bob");
    await act(async () => renderer!.unmount());
    await showTask(BOB, "VL9");
    expect(words(renderer!.root)).toContain("Owner Bob (you)");
  });

  it("says a task owned through its area is, and by whom", async () => {
    await showTask(ANA, "VL10");
    expect(words(renderer!.root)).toContain("Owned through Payments · you");
    await act(async () => renderer!.unmount());
    await showTask(CYRIL, "VL10");
    expect(words(renderer!.root)).toContain("Owned through Payments · Ana");
  });

  it("says a task has no owner, once ownership is known for the project", async () => {
    await showTask(CYRIL, "VL11");
    expect(words(renderer!.root)).toContain("No owner");
  });

  it("says nothing of owners where ownership is not known: the plugin is off, or the Hub does not serve it", async () => {
    await showTask(CYRIL, "VL11", { ownership: null });
    expect(words(renderer!.root)).not.toContain("No owner");
    await act(async () => renderer!.unmount());
    await showTask(CYRIL, "VL9", { ownership: null });
    expect(words(renderer!.root)).not.toContain("Owner");
  });

  it("says whose review a task in review waits for when it asks someone else, and offers no Review", async () => {
    // VL9 is in review and Bob owns it: its review asks Bob, not Cyril.
    const inReview = (email: string) => {
      const project = workProject(email);
      const [payments, ...others] = project.areas;
      const [vl7, vl9] = payments!.tasks;
      return {
        ...project,
        areas: [{ ...payments!, tasks: [vl7!, { ...vl9!, inReview: true }] }, ...others],
      };
    };
    const card = (email: string) =>
      taskCards([inReview(email)], { scope: ALL_PROJECTS, mine: false, query: "", me: email }).find(
        (candidate) => candidate.kind === "task" && candidate.task.key === "VL9",
      ) as Extract<TaskCard, { kind: "task" }>;
    const render = async (email: string) => {
      await act(async () => {
        renderer = create(
          <TaskCardView
            card={card(email)}
            here={here}
            status={statusFor(email)}
            showProject={false}
            actions={actions}
          />,
        );
      });
    };
    await render(CYRIL);
    expect(words(renderer!.root)).toContain("Waiting for Bob's review");
    expect(button("Review")).toBeUndefined();
    await act(async () => renderer!.unmount());
    await render(BOB);
    expect(words(renderer!.root)).toContain("Waiting for your review");
    expect(button("Review")).toBeDefined();
  });
});
