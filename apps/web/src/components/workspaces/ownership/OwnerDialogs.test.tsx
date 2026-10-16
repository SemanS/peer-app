import { PeerHubError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ set: vi.fn(), status: null as unknown }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { setTaskOwner: null } },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.set }));
vi.mock("../WorkspaceAccess", () => ({ usePeerHubStatus: () => mocks.status }));
vi.mock("../../ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogClose: ({ render }: { render: ReactNode }) => render,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: Part,
    DialogPanel: Part,
    DialogFooter: Part,
  };
});

import { OwnerDialogs } from "./OwnerDialogs";
import { closeOwnerDialog, openOwnerDialog } from "./ownerDialog";
import { ANA, BOB, CYRIL, ENV, EVA, statusFor, type Looking } from "./ownership.testkit";

let renderer: ReactTestRenderer | null = null;

/** Everything a node says, in the order it says it. */
function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const buttons = () => renderer!.root.findAllByType("button");
const button = (label: string) => buttons().find((candidate) => words(candidate) === label);
const rows = () =>
  renderer!.root
    .findAll(
      (node) => node.type === "label" && node.findAllByProps({ "data-slot": "radio" }).length > 0,
    )
    .map((row) => words(row));

async function open(email: string, id: string, kind: "set" | "hand-over", looking?: Looking) {
  mocks.status = statusFor(email, looking);
  await act(async () => {
    renderer = create(<OwnerDialogs environmentIds={[ENV]} />);
  });
  await act(async () => {
    openOwnerDialog({
      kind,
      environmentId: ENV,
      workspace: "acme",
      project: "ordering",
      task: id,
    });
  });
}

/** Picks the row of a person in the list the way a click on it does. */
async function pick(value: string) {
  const group = renderer!.root.find(
    (node) =>
      typeof node.props.onValueChange === "function" && node.props["aria-label"] === "Owner",
  );
  await act(async () => group.props.onValueChange(value));
}

async function search(text: string) {
  const field = renderer!.root.find(
    (node) => node.type === "input" && node.props.type === "search",
  );
  const event = { currentTarget: { value: text }, target: { value: text }, nativeEvent: {} };
  await act(async () => field.props.onChange(event));
}

async function submit() {
  await act(async () => {
    await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
}

const refused = (detail: string, code = "ownership_forbidden") =>
  AsyncResult.failure(Cause.fail(new PeerHubError({ detail, code })));
const done = { _tag: "Success", value: { changed: true } };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.set.mockReset();
});
afterEach(async () => {
  await act(async () => {
    closeOwnerDialog();
    renderer?.unmount();
  });
  renderer = null;
});

describe("Set owner", () => {
  it("offers no owner first and then the project's members, with the current owner picked", async () => {
    await open(EVA, "vl9", "set");
    expect(words(renderer!.root.findByType("h2"))).toBe("Set the owner of VL9");
    expect(rows()).toEqual([
      "– No owner Falls back to the area owner, if any",
      "A Ana Owns the area Payments",
      "B Bob Owns 1 task",
      "C Cyril",
      "E Eva (you)",
    ]);
    // Nothing is picked that would change anything, so there is nothing to confirm or explain.
    expect(button("Make Bob the owner")?.props.disabled).toBe(true);
    expect(words(renderer!.root)).not.toContain("will see");
  });

  it("names the owner the person picks, and says what that means before it is sent", async () => {
    await open(EVA, "vl10", "set");
    await pick(CYRIL);
    expect(button("Make Cyril the owner")).toBeDefined();
    expect(words(renderer!.root)).toContain(
      "Cyril will see VL10 under Mine and can give it back. The change is recorded in the project's history with your name.",
    );
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("sends the owner for the task and closes once the Hub has it", async () => {
    mocks.set.mockResolvedValue(done);
    await open(EVA, "vl10", "set");
    await pick(CYRIL);
    await submit();
    expect(mocks.set).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        project: "ordering",
        task: "vl10",
        owner: CYRIL,
        op: expect.any(String),
      },
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  it("takes the owner away with No owner", async () => {
    mocks.set.mockResolvedValue(done);
    await open(EVA, "vl9", "set");
    await pick("no-owner");
    expect(button("Clear the owner")).toBeDefined();
    await submit();
    expect(mocks.set.mock.calls[0]![0].input).toMatchObject({ task: "vl9", owner: null });
  });

  it("keeps the dialog open, with the Hub's reason, when the change is refused, and retries as one operation", async () => {
    mocks.set.mockResolvedValue(refused("Only a lead or an admin can name an owner."));
    await open(EVA, "vl10", "set");
    await pick(CYRIL);
    await submit();
    expect(renderer!.toJSON()).not.toBeNull();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "Only a lead or an admin can name an owner.",
    );
    await submit();
    const [first, second] = mocks.set.mock.calls.map((call) => call[0].input.op);
    expect(second).toBe(first);
    // Choosing someone else is another change.
    await pick(ANA);
    expect(renderer!.root.findAllByProps({ role: "alert" })).toEqual([]);
    await submit();
    expect(mocks.set.mock.calls[2]![0].input.op).not.toBe(first);
  });

  it("narrows the people by what is typed", async () => {
    await open(EVA, "vl10", "set");
    await search("cy");
    expect(rows()).toEqual(["C Cyril"]);
    await search("nobody");
    expect(rows()).toEqual([]);
    expect(words(renderer!.root)).toContain("No one on this project matches.");
  });

  it("closes when the task or its ownership goes away from under it", async () => {
    await open(EVA, "vl10", "set");
    expect(renderer!.toJSON()).not.toBeNull();
    mocks.status = statusFor(EVA, { ownership: null });
    await act(async () => renderer!.update(<OwnerDialogs environmentIds={[ENV]} />));
    expect(renderer!.toJSON()).toBeNull();
  });
});

describe("Hand over", () => {
  it("offers the other members, never the person handing over, and confirms nothing until one is picked", async () => {
    await open(BOB, "vl9", "hand-over");
    expect(words(renderer!.root.findByType("h2"))).toBe("Hand over VL9");
    expect(rows()).toEqual([
      "A Ana ana@acme.test · owns the area Payments",
      "C Cyril cyril@acme.test",
      "E Eva eva@acme.test",
    ]);
    expect(buttons().find((candidate) => candidate.props.type === "submit")?.props.disabled).toBe(
      true,
    );
  });

  it("says what happens next for the person's agents and the call they have open", async () => {
    await open(BOB, "vl9", "hand-over", {
      sessions: [
        { workspace: "acme", project: "ordering", email: BOB, task: "vl9", status: "working" },
      ],
      ownership: {
        calls: [
          {
            id: "call-1",
            project: "ordering",
            task: "vl9",
            session: "claude:s1",
            email: BOB,
            environment: "env-bob",
            owner: ANA,
            paths: ["src/payments/fees.ts"],
            reason: "add a refund fee field",
            state: "pending",
            onBehalf: false,
            createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
            updatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
            expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
          },
        ],
      },
    });
    await pick(ANA);
    const said = words(renderer!.root);
    expect(said).toContain(
      "Your agents on VL9 keep working; they hear once that Ana owns the task now.",
    );
    expect(said).toContain("Your pending call to Ana stays open. Ana can give the task back.");
    expect(button("Hand over to Ana")).toBeDefined();
  });

  it("sends the new owner and closes", async () => {
    mocks.set.mockResolvedValue(done);
    await open(BOB, "vl9", "hand-over");
    await pick(ANA);
    await submit();
    expect(mocks.set).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        project: "ordering",
        task: "vl9",
        owner: ANA,
        op: expect.any(String),
      },
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  it("stays open and says why when the Hub refuses", async () => {
    mocks.set.mockResolvedValue(refused("Only the task's owner can hand it over."));
    await open(BOB, "vl9", "hand-over");
    await pick(ANA);
    await submit();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "Only the task's owner can hand it over.",
    );
    expect(renderer!.toJSON()).not.toBeNull();
  });
});
