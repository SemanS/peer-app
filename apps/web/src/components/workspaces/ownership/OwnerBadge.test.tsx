import { PeerHubError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  withdraw: vi.fn(),
  pick: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerOwnership: { withdraw: null, setTaskOwner: null } },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.withdraw }));
vi.mock("../../../rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("../workFeedback", () => ({ reportFailure: () => true }));
vi.mock("../useWorkActions", () => ({
  below: () => ({ x: 0, y: 0 }),
  pickFromMenu: mocks.pick,
}));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => NOW }));
vi.mock("./ownerDialog", () => ({ openOwnerDialog: mocks.open }));
vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  PopoverPopup: ({ children }: { children: ReactNode }) => <div data-popup>{children}</div>,
  PopoverTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
}));

import { OwnerBadge } from "./OwnerBadge";
import {
  ANA,
  BOB,
  CYRIL,
  ENV,
  EVA,
  NOW,
  ownerCall,
  slotProps,
  type Looking,
} from "./ownership.testkit";

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function show(email: string, id: string, looking?: Looking) {
  await act(async () => {
    renderer = create(<OwnerBadge {...slotProps(email, id, looking)} />);
  });
}

const buttons = () => renderer!.root.findAllByType("button");
/** The owner chip is the first badge: who owns the task, before any call waiting on it. */
const ownerChip = () => renderer!.root.findAll((node) => node.props["data-slot"] === "badge")[0]!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.withdraw.mockReset();
  mocks.pick.mockReset();
  mocks.open.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("the owner badge on a task's page", () => {
  it("says who owns the task, to everyone, and is a menu only for who may change it", async () => {
    await show(BOB, "vl9");
    expect(words(ownerChip())).toBe("B Owner: Bob (you)");
    expect(ownerChip().type).toBe("button");
    expect(ownerChip().props["aria-haspopup"]).toBe("menu");
    await act(async () => renderer!.unmount());

    await show(CYRIL, "vl9");
    expect(words(ownerChip())).toBe("B Owner: Bob");
    // Cyril can change nothing, so the badge is no button.
    expect(ownerChip().type).toBe("span");
    expect(buttons()).toEqual([]);
  });

  it("says a task owned through its area, and that nobody owns one that is not", async () => {
    await show(ANA, "vl10");
    expect(words(ownerChip())).toBe("A Owned through Payments · you");
    await act(async () => renderer!.unmount());
    await show(CYRIL, "vl11");
    expect(words(ownerChip())).toBe("– No owner");
  });

  it("offers a lead the owner items of an unowned task from the badge", async () => {
    mocks.pick.mockResolvedValue("owner:set");
    await show(EVA, "vl11");
    await act(async () => ownerChip().props.onClick({}));
    expect(mocks.pick).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "owner:set", label: "Set owner…" })],
      { x: 0, y: 0 },
    );
    expect(mocks.open).toHaveBeenCalledWith({
      kind: "set",
      environmentId: ENV,
      workspace: "acme",
      project: "ordering",
      task: "vl11",
    });
  });

  it("does nothing when the person leaves the menu without choosing", async () => {
    mocks.pick.mockResolvedValue(null);
    await show(BOB, "vl9");
    await act(async () => ownerChip().props.onClick({}));
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("draws nothing where ownership is not known for the project", async () => {
    await show(EVA, "vl9", { ownership: null });
    expect(renderer!.toJSON()).toBeNull();
  });
});

describe("a call waiting on the task", () => {
  const calls: Looking = { ownership: { calls: [ownerCall()] } };
  const pill = () => buttons().find((button) => /call ·/.test(words(button)));

  it("says whom it waits on, and for the person who decides it, that it waits on them", async () => {
    await show(BOB, "vl9", calls);
    expect(words(pill()!)).toBe("Waiting on Ana's call · 40 min");
    await act(async () => renderer!.unmount());
    await show(ANA, "vl9", calls);
    expect(words(pill()!)).toBe("Waits for your call · 40 min");
  });

  it("tells what it asks: the path, who decides it, the agent's reason and when it ends", async () => {
    await show(BOB, "vl9", calls);
    const popup = words(renderer!.root.findByProps({ "data-popup": true }));
    expect(popup).toContain("Your agent asked Ana to change a path they decide");
    expect(popup).toContain(
      "src/payments/fees.ts · Ana decides changes by others in src/payments/**",
    );
    expect(popup).toContain("Reason from your agent: “add a refund fee field”");
    expect(popup).toContain("Asked 40 min ago · expires in 6 days");
  });

  it("lets the person whose agent asked take the call back, and nobody else", async () => {
    mocks.withdraw.mockResolvedValue({ _tag: "Success" });
    await show(BOB, "vl9", calls);
    const withdraw = buttons().find((button) => words(button) === "Withdraw the call")!;
    await act(async () => withdraw.props.onClick());
    expect(mocks.withdraw).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { workspace: "acme", project: "ordering", id: "call-1" },
    });
    await act(async () => renderer!.unmount());

    for (const email of [CYRIL, ANA, EVA]) {
      await show(email, "vl9", calls);
      expect(
        buttons().some((button) => words(button) === "Withdraw the call"),
        email,
      ).toBe(false);
      await act(async () => renderer!.unmount());
    }
  });

  it("says why a call could not be taken back, when it is no longer pending", async () => {
    mocks.withdraw.mockResolvedValue(
      AsyncResult.failure(
        Cause.fail(new PeerHubError({ detail: "conflict", code: "owner_call_closed" })),
      ),
    );
    await show(BOB, "vl9", calls);
    const withdraw = buttons().find((button) => words(button) === "Withdraw the call")!;
    await act(async () => withdraw.props.onClick());
    expect(words(renderer!.root.findByProps({ role: "alert" }))).toBe(
      "This call is no longer pending.",
    );
  });
});
