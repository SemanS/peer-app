import type { PeerWebhook, PeerWebhookDelivery, PeerWorkspaceState } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  refreshList: vi.fn(),
  refreshDeliveries: vi.fn(),
  requeue: vi.fn(),
  list: null as unknown,
  deliveries: null as unknown,
}));
vi.mock("../../../state/query", () => ({
  // The list and the open row's deliveries are two queries; none is read for a row that is shut.
  useEnvironmentQuery: (atom: string | null) => ({
    data: atom === "list" ? mocks.list : atom === "deliveries" ? mocks.deliveries : null,
    error: null,
    isPending: false,
    refresh:
      atom === "list"
        ? mocks.refreshList
        : atom === "deliveries"
          ? mocks.refreshDeliveries
          : vi.fn(),
  }),
}));
vi.mock("../webhooks/atoms", () => ({
  webhookAtoms: {
    list: () => "list",
    deliveries: () => "deliveries",
    requeue: "requeue",
    test: "test",
  },
}));
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "requeue" ? mocks.requeue : vi.fn()),
}));
vi.mock("../../../timestampFormat", () => ({ formatRelativeTimeLabel: () => "just now" }));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => undefined }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => null }));
vi.mock("../PeerPageHeader", () => ({
  PeerCard: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}));
vi.mock("./useSettingsView", () => ({
  useSettingsView: () => ({ hubHasSettings: false, document: null, revision: null }),
}));
vi.mock("./WebhookDialog", () => ({ WebhookDialog: () => null }));
vi.mock("../../ui/tooltip", () => ({
  Tooltip: () => null,
  TooltipPopup: () => null,
  TooltipTrigger: () => null,
}));
vi.mock("../../ui/button", () => {
  const Press = (props: {
    children?: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
    disabled?: boolean;
  }) => (
    <button aria-label={props["aria-label"]} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
  return { Button: Press, InlineButton: Press };
});

import { WebhooksCard } from "./IntegrationsWebhooks";

let renderer: ReactTestRenderer | null = null;

const webhook: PeerWebhook = {
  id: "team-slack",
  format: "slack",
  events: ["task.review"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "hooks.slack.com" },
  signing: "derived",
  health: {
    pending: 0,
    failed: 1,
    lastDeliveredAt: null,
    lastFailure: { at: "2026-10-15T22:04:00Z", class: "blocked" },
  },
};

const failedDelivery = (attempts: number): PeerWebhookDelivery => ({
  id: "msg_1",
  event: "task.review",
  project: "shop",
  title: "Order notes header",
  state: "failed",
  createdAt: "2026-10-15T22:03:56Z",
  attempts,
  nextAttempt: null,
  failure: { at: "2026-10-15T22:04:00Z", class: "blocked" },
});

const workspace = { slug: "acme", name: "Acme", projects: [] } as unknown as PeerWorkspaceState;

/** Everything a node says, in the order it says it. */
function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const buttons = (label: string) =>
  renderer!.root
    .findAllByType("button")
    .filter((candidate) => words(candidate) === label || candidate.props["aria-label"] === label);

async function press(button: ReactTestInstance | undefined) {
  await act(async () => button!.props.onClick());
}

async function open() {
  await act(async () => {
    renderer = create(<WebhooksCard environmentId={"env" as never} workspace={workspace} />);
  });
  await press(buttons("Deliveries of Team slack")[0]);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.refreshList.mockReset();
  mocks.refreshDeliveries.mockReset();
  mocks.requeue.mockReset();
  mocks.list = { revision: "r1", webhooks: [webhook] };
  mocks.deliveries = { deliveries: [failedDelivery(1)] };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("the webhooks card", () => {
  it("reads the list and the open webhook's failed deliveries together with the card's Refresh", async () => {
    await open();
    await press(buttons("Refresh")[0]);
    // The status and the counts come from the list and the rows below from the deliveries; reading
    // one without the other leaves them telling different stories.
    expect(mocks.refreshList).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeliveries).toHaveBeenCalledTimes(1);
  });

  it("reads both with the Refresh in a webhook's details", async () => {
    await open();
    await press(buttons("Refresh")[1]);
    expect(mocks.refreshList).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeliveries).toHaveBeenCalledTimes(1);
  });

  it("reads both after the failed deliveries are requeued from the row", async () => {
    mocks.requeue.mockResolvedValue({ _tag: "Success", value: { requeued: 1 } });
    await open();
    await press(buttons("Requeue the failed deliveries of Team slack")[0]);
    expect(mocks.refreshList).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeliveries).toHaveBeenCalledTimes(1);
    expect(words(renderer!.root)).toContain("Team slack: 1 delivery requeued.");
  });

  it("reads only the list while no webhook is open", async () => {
    await act(async () => {
      renderer = create(<WebhooksCard environmentId={"env" as never} workspace={workspace} />);
    });
    await press(buttons("Refresh")[0]);
    expect(mocks.refreshList).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeliveries).not.toHaveBeenCalled();
  });

  it("counts a failed delivery's attempts in the right number", async () => {
    await open();
    expect(words(renderer!.root)).toContain(
      "The destination is not a public HTTPS address · 1 attempt",
    );
    expect(words(renderer!.root)).not.toContain("1 attempts");
    mocks.deliveries = { deliveries: [failedDelivery(3)] };
    await act(async () =>
      renderer!.update(<WebhooksCard environmentId={"env" as never} workspace={workspace} />),
    );
    expect(words(renderer!.root)).toContain("· 3 attempts");
  });
});
