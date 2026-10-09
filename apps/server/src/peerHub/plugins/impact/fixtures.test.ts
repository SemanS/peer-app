import type { PeerSessionView } from "../../core/plugin.ts";
import type { PeerPluginId, PeerImpactView } from "@t3tools/contracts";
export function sessionView(overrides: Partial<PeerSessionView> = {}): PeerSessionView {
  const data = new Map<PeerPluginId, unknown>();
  return {
    id: "claude:a",
    agent: "claude",
    adapter: "hooks",
    runtimeGeneration: "r",
    workspace: "acme",
    project: "p",
    repositoryId: "api",
    root: "/test",
    cwd: "/test",
    task: "a",
    thread: undefined,
    pane: undefined,
    status: "working",
    keeps: false,
    files: [],
    claims: [],
    local: <S>(id: PeerPluginId, init: () => S) => {
      if (!data.has(id)) data.set(id, init());
      return data.get(id) as S;
    },
    ...overrides,
  };
}
const side = {
  session: "claude:a",
  email: "ana@test",
  environment: "a",
  label: "Work A",
  task: "a",
};
export const impactView: PeerImpactView = {
  records: [
    {
      id: "123456789012",
      project: "p",
      sides: [side, { ...side, session: "codex:b", task: "b", email: "bob@test" }],
      items: [
        {
          name: "price",
          path: "money.ts",
          change: "signature",
          changer: "claude:a",
          from: [{ name: "receipt", path: "receipt.ts" }],
        },
      ],
      state: "open",
      live: true,
      reopened: false,
      openedAt: "2026-10-09T12:00:00Z",
      updatedAt: "2026-10-09T12:00:00Z",
    },
  ],
  provided: [],
};
// This module supplies shared fixture values without running a second copy of another suite.

import { it, expect } from "vite-plus/test";
import { tell } from "./tell.ts";
it("new sessions with the same external identity get independent advice state", () => {
  const first = sessionView(),
    replacement = sessionView();
  expect(tell(first, impactView, "ready", 0, false)).not.toBeNull();
  expect(tell(first, impactView, "ready", 0, false)).toBeNull();
  expect(tell(replacement, impactView, "ready", 0, false)).not.toBeNull();
});
