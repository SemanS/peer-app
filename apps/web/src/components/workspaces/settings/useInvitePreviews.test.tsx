// @vitest-environment jsdom
import { EnvironmentId, type PeerInvitePreview } from "@t3tools/contracts";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useInvitePreviews } from "./useInvitePreviews";

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerHubInvitePreview: "preview" },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => ask }));
const pending = new Map<
  string,
  (value: { _tag: "Success"; value: PeerInvitePreview | null }) => void
>();
let root: Root;
let current: ReadonlyArray<PeerInvitePreview> = [];
function Probe({
  environment = "first",
  workspace = "team",
  emails,
}: {
  environment?: string;
  workspace?: string;
  emails: ReadonlyArray<string>;
}) {
  const previews = useInvitePreviews(EnvironmentId.make(environment), workspace, emails);
  useEffect(() => {
    current = previews;
  });
  return null;
}
const preview = (email: string, openProjects: ReadonlyArray<string>): PeerInvitePreview => ({
  email,
  openProjects,
  restrictedProjects: [],
  capacity: { memberLimit: null, members: 0, pending: 0 },
  alreadyMember: false,
  wouldExceed: false,
  readmits: false,
});
const resolve = (
  environment: string,
  workspace: string,
  email: string,
  value: PeerInvitePreview | null,
) => pending.get(`${environment}:${workspace}:${email}`)!({ _tag: "Success", value });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ask.mockImplementation(
    ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { workspace: string; email: string };
    }) =>
      new Promise((resolve) =>
        pending.set(`${environmentId}:${input.workspace}:${input.email}`, resolve),
      ),
  );
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(() => root.unmount());
  pending.clear();
  ask.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("requests each address and keeps access separate when responses complete out of order", async () => {
  await act(() =>
    root.render(createElement(Probe, { emails: ["alice@test.dev", "bob@test.dev"] })),
  );
  await act(() => vi.advanceTimersByTime(400));
  expect(ask).toHaveBeenCalledTimes(2);
  await act(() => resolve("first", "team", "bob@test.dev", preview("bob@test.dev", ["Shared"])));
  expect(current).toEqual([]);
  await act(() =>
    resolve("first", "team", "alice@test.dev", preview("alice@test.dev", ["Alice only", "Shared"])),
  );
  expect(current.map(({ email, openProjects }) => ({ email, openProjects }))).toEqual([
    { email: "alice@test.dev", openProjects: ["Alice only", "Shared"] },
    { email: "bob@test.dev", openProjects: ["Shared"] },
  ]);
});
it("withholds old previews and ignores responses from earlier addresses or destinations", async () => {
  await act(() => root.render(createElement(Probe, { emails: ["old@test.dev"] })));
  await act(() => vi.advanceTimersByTime(400));
  await act(() =>
    root.render(
      createElement(Probe, { environment: "second", workspace: "other", emails: ["new@test.dev"] }),
    ),
  );
  await act(() => vi.advanceTimersByTime(400));
  await act(() =>
    resolve("first", "team", "old@test.dev", preview("old@test.dev", ["Old project"])),
  );
  expect(current).toEqual([]);
  await act(() =>
    resolve("second", "other", "new@test.dev", preview("new@test.dev", ["New project"])),
  );
  expect(current[0]?.openProjects).toEqual(["New project"]);
  await act(() =>
    root.render(createElement(Probe, { environment: "second", workspace: "other", emails: [] })),
  );
  expect(current).toEqual([]);
});
it("leaves failed or unsupported address previews unknown instead of borrowing another person’s access", async () => {
  await act(() =>
    root.render(createElement(Probe, { emails: ["alice@test.dev", "older@test.dev"] })),
  );
  await act(() => vi.advanceTimersByTime(400));
  await act(() => {
    resolve("first", "team", "alice@test.dev", preview("alice@test.dev", ["Alice only"]));
    resolve("first", "team", "older@test.dev", null);
  });
  expect(current.map((one) => one.email)).toEqual(["alice@test.dev"]);
});
