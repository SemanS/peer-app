import { PeerHubError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  dismiss: null as null | ((open: boolean) => void),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { decide: null } },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.decide }));
vi.mock("../../ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({
      children,
      onOpenChange,
    }: {
      children?: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => {
      mocks.dismiss = onOpenChange;
      return <div>{children}</div>;
    },
    DialogClose: ({ render }: { render: ReactNode }) => render,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogDescription: Part,
    DialogPanel: Part,
    DialogFooter: Part,
  };
});

import { OwnerCallDecision } from "./OwnerCallDecision";
import { ENV, ownerCall } from "./ownership.testkit";

let renderer: ReactTestRenderer | null = null;
const onClose = vi.fn();

function words(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function show(props: { decision?: "accept" | "decline"; onBehalf?: boolean } = {}) {
  await act(async () => {
    renderer = create(
      <OwnerCallDecision
        environmentId={ENV}
        workspace="acme"
        project="ordering"
        call={ownerCall()}
        asker="Bob"
        owner="Ana"
        onBehalf={props.onBehalf ?? false}
        task="ORD-9"
        decision={props.decision ?? "accept"}
        onClose={onClose}
      />,
    );
  });
}

async function type(text: string) {
  const note = renderer!.root.findByType("textarea");
  const event = { currentTarget: { value: text }, target: { value: text }, nativeEvent: {} };
  await act(async () => note.props.onChange(event));
}
const send = () =>
  act(async () => {
    await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
const confirm = () =>
  renderer!.root.findAllByType("button").find((button) => button.props.type === "submit")!;
const refused = (detail: string, code: string) =>
  AsyncResult.failure(Cause.fail(new PeerHubError({ detail, code })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.decide.mockReset();
  onClose.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("accepting an owner's call", () => {
  it("sends the acceptance with the owner's note, and closes once the Hub has it", async () => {
    mocks.decide.mockResolvedValue({ _tag: "Success", value: {} });
    await show();
    expect(words(renderer!.root.findByType("h2"))).toBe("Accept Bob's agent's call?");
    expect(words(renderer!.root)).toContain("Note for Bob's agent (optional)");
    await type("keep fees in integer cents");
    expect(words(renderer!.root)).toContain("26 / 300");
    await send();
    expect(mocks.decide).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        project: "ordering",
        id: "call-1",
        decision: "accept",
        note: "keep fees in integer cents",
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("needs no note: nothing is sent for an empty one", async () => {
    mocks.decide.mockResolvedValue({ _tag: "Success", value: {} });
    await show();
    await type("   ");
    await send();
    expect(mocks.decide.mock.calls[0]![0].input).toEqual({
      workspace: "acme",
      project: "ordering",
      id: "call-1",
      decision: "accept",
    });
  });

  it("takes no more than 300 characters, so that what is written is never refused for its length", async () => {
    await show();
    await type("x".repeat(305));
    expect(words(renderer!.root)).toContain("300 / 300");
    expect(renderer!.root.findByType("textarea").props.value).toHaveLength(300);
  });

  it("says when a lead decides for the owner, and still sends the same decision", async () => {
    mocks.decide.mockResolvedValue({ _tag: "Success", value: {} });
    await show({ onBehalf: true });
    expect(words(renderer!.root.findByType("h2"))).toBe("Accept Bob's agent's call for Ana?");
    expect(words(renderer!.root)).toContain("The record says you decided for Ana.");
    expect(words(confirm())).toBe("Accept for Ana");
    await send();
    expect(mocks.decide.mock.calls[0]![0].input).toMatchObject({ decision: "accept" });
  });
});

describe("declining an owner's call", () => {
  it("sends the decline with the note the asking agent will read", async () => {
    mocks.decide.mockResolvedValue({ _tag: "Success", value: {} });
    await show({ decision: "decline" });
    expect(words(renderer!.root.findByType("h2"))).toBe("Decline Bob's agent's call?");
    expect(words(renderer!.root)).toContain(
      "Its edits of src/payments/fees.ts stay stopped. It reads your note and can ask again.",
    );
    await type("use the existing fee table in fees.ts");
    await send();
    expect(mocks.decide.mock.calls[0]![0].input).toMatchObject({
      decision: "decline",
      note: "use the existing fee table in fees.ts",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("a decision the Hub refuses", () => {
  it("stays open with the Hub's reason, so the person can see why and try again", async () => {
    mocks.decide.mockResolvedValue(
      refused("You can't decide a call your own agent opened.", "ownership_forbidden"),
    );
    await show();
    await type("ok");
    await send();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "You can't decide a call your own agent opened.",
    );
    expect(onClose).not.toHaveBeenCalled();
    // The note they wrote is still there.
    expect(renderer!.root.findByType("textarea").props.value).toBe("ok");
  });

  it("says a call that is no longer pending is no longer pending", async () => {
    mocks.decide.mockResolvedValue(refused("conflict", "owner_call_closed"));
    await show();
    await send();
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "This call is no longer pending.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cannot be dismissed while the decision is on its way, and can be once it is not", async () => {
    let settle: (result: unknown) => void = () => undefined;
    mocks.decide.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    await show();
    await act(async () => {
      void renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    expect(words(confirm())).toBe("Accepting…");
    await act(async () => mocks.dismiss?.(false));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => settle(refused("nope", "ownership_forbidden")));
    await act(async () => mocks.dismiss?.(false));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
