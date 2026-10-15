import type { PeerWebhook, PeerWebhookDelivery } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  refreshDeliveries: vi.fn(),
  deliveries: { deliveries: [] } as { deliveries: unknown[] },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: mocks.deliveries,
    error: null,
    isPending: false,
    refresh: mocks.refreshDeliveries,
  }),
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../../timestampFormat", () => ({ formatRelativeTimeLabel: () => "just now" }));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => undefined }));
vi.mock("../webhooks/atoms", () => ({ webhookAtoms: { deliveries: () => null } }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => null }));
vi.mock("../PeerPageHeader", () => ({ PeerCard: () => null }));
vi.mock("./useSettingsView", () => ({ useSettingsView: () => null }));
vi.mock("./WebhookDialog", () => ({ WebhookDialog: () => null }));
vi.mock("../../ui/tooltip", () => ({
  Tooltip: () => null,
  TooltipPopup: () => null,
  TooltipTrigger: () => null,
}));
vi.mock("../../ui/button", () => {
  const Press = ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  );
  return { Button: Press, InlineButton: Press };
});

import { WebhookDetails } from "./IntegrationsWebhooks";

let renderer: ReactTestRenderer | null = null;

const entry: PeerWebhook = {
  id: "team-slack",
  format: "slack",
  events: ["task.review"],
  projects: null,
  enabled: true,
  destination: { state: "ok", host: "hooks.slack.com" },
  signing: "derived",
  health: { pending: 1, failed: 0, lastDeliveredAt: null, lastFailure: null },
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

/** Everything a node says, in the order it says it. */
function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function open(onChanged: () => void) {
  await act(async () => {
    renderer = create(
      <WebhookDetails
        environmentId={"env" as never}
        workspace="acme"
        entry={entry}
        onChanged={onChanged}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.refreshDeliveries.mockReset();
  mocks.deliveries = { deliveries: [] };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("a webhook's details", () => {
  it("reads the webhook's status again with Refresh, not only its failed deliveries", async () => {
    const onChanged = vi.fn();
    await open(onChanged);
    const refresh = renderer!.root
      .findAllByType("button")
      .find((candidate) => words(candidate) === "Refresh");
    await act(async () => refresh!.props.onClick());
    // The line above the rows (how many failed or wait) and the badge on the row come from the
    // webhook list; the rows come from the deliveries. Both are read, so they tell the same story.
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(mocks.refreshDeliveries).toHaveBeenCalledTimes(1);
  });

  it("counts a failed delivery's attempts in the right number", async () => {
    mocks.deliveries = { deliveries: [failedDelivery(1)] };
    await open(vi.fn());
    expect(words(renderer!.root)).toContain(
      "The destination is not a public HTTPS address · 1 attempt ",
    );
    mocks.deliveries = { deliveries: [failedDelivery(3)] };
    await act(async () =>
      renderer!.update(
        <WebhookDetails
          environmentId={"env" as never}
          workspace="acme"
          entry={entry}
          onChanged={vi.fn()}
        />,
      ),
    );
    expect(words(renderer!.root)).toContain("· 3 attempts");
  });
});
