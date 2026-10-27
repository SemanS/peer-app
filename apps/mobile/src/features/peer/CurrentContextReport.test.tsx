// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type PeerContextView, type PeerHubStatus } from "@t3tools/contracts";

vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  TextInput: ({
    value,
    onChangeText,
  }: {
    value: string;
    onChangeText: (value: string) => void;
  }) => <input value={value} onChange={(event) => onChangeText(event.target.value)} />,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    peerHubContextView: ({ input }: { input: Record<string, unknown> }) => ({
      kind: "view",
      input,
    }),
    peerHubReadContextVersion: ({ input }: { input: Record<string, unknown> }) => ({
      kind: "history",
      input,
    }),
    peerHubContextArchive: ({ input }: { input: Record<string, unknown> }) => ({
      kind: "archive",
      input,
    }),
  },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: { kind: string; input: Record<string, unknown> } | null) => {
    const [refreshed, setRefreshed] = useState(false);
    const refresh = () => setRefreshed(true);
    if (query === null) return { data: null, error: null, refresh };
    const { input } = query;
    const coverage = { total: 2, omittedCount: 0, nextCursor: null, historyAvailableFrom: null };
    if (query.kind === "history")
      return {
        refresh,
        error: null,
        data: { version: input.version, text: `Exact source revision ${input.version}` },
      };
    if (query.kind === "archive")
      return {
        refresh,
        error: null,
        data: {
          availability: "available",
          entries: [
            {
              scope: input.cursor ? "task:second" : "task:first",
              title: input.cursor ? "Second archived work" : "First archived work",
              closed: input.history === true,
              revision: 7,
              gist: refreshed ? "Refreshed archived report" : "Archived report",
            },
          ],
          coverage: {
            ...coverage,
            omittedCount: input.cursor ? 0 : 1,
            nextCursor: input.cursor ? null : "archive-2",
          },
        },
      };
    const second = input.inputCursor === "inputs-2";
    return {
      refresh,
      error: null,
      data: {
        identity: {
          backend: "local",
          authority: "local:test",
          environment: "test",
          workspace: "team",
          project: "app",
          scope: String(input.scope),
        },
        current: {
          goal: [],
          outcome: [
            {
              text: `Report ${input.scope}${refreshed ? " · refreshed source state" : ""}`,
              sourceRefs: ["source"],
            },
          ],
          attention: [
            {
              text: "None for the import. Feature tasks intentionally remain open.",
              sourceRefs: ["source"],
            },
          ],
          next: [],
        },
        sources: [
          {
            id: "source",
            kind: "context",
            objectId: String(input.scope),
            scope: String(input.scope),
            revision: "7",
            observedAt: "2026-10-26",
            availability: "available",
          },
        ],
        inputs: {
          state: input.scope === "project-aggregate" ? "unavailable" : "complete",
          required: [
            {
              scope: second ? "task:input-b" : "task:input-a",
              revision: 2,
              currentRevision: 2,
              observedAt: "2026-10-26",
            },
          ],
          coverage: {
            ...coverage,
            omittedCount: second ? 0 : 1,
            nextCursor: second ? null : "inputs-2",
          },
        },
        pendingFindings: {
          availability: "available",
          ids: [input.findingCursor ? "finding-b" : "finding-a"],
          items: [
            {
              id: input.findingCursor ? "finding-b" : "finding-a",
              text: input.findingCursor
                ? "Check the validator outside the status window"
                : "Check the parser",
              email: "teammate@example.test",
              at: "2026-10-26",
              scope: String(input.scope),
            },
          ],
          coverage: {
            ...coverage,
            omittedCount: input.findingCursor ? 0 : 1,
            nextCursor: input.findingCursor ? null : "findings-2",
          },
        },
        coverage,
        generatedAt: "2026-10-26",
        verifiedAt: null,
      } satisfies PeerContextView,
    };
  },
}));

import { CurrentContextReport } from "./CurrentContextReport";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("mobile context evidence and archive", () => {
  it("pages evidence and reports, then reads archived publication inputs without an active keeper", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const status = {
      environmentId: "test",
      hubUrl: "https://hub.example",
      email: null,
      signedIn: false,
      workspaces: [],
      coordination: {
        enabled: true,
        sessions: [],
        contexts: [
          {
            workspace: "team",
            project: "app",
            scope: "task:second",
          },
        ],
        findings: [{ id: "finding-a", text: "Check the parser" }],
      },
    } as unknown as PeerHubStatus;
    act(() =>
      root!.render(
        <CurrentContextReport
          environmentId={EnvironmentId.make("test")}
          workspace="team"
          project="app"
          revision="1"
          status={status}
        />,
      ),
    );
    const click = (text: string) =>
      act(() => {
        const button = [...container!.querySelectorAll("button")].find(
          (button) => button.textContent === text,
        );
        expect(button).toBeDefined();
        button!.click();
      });
    expect(container.textContent).toContain("task:input-a: required v2");
    expect(container.textContent).toContain("Inputs read: Not recorded");
    expect(container.textContent).not.toContain("Needs attention");
    click("Refresh current context");
    expect(container.textContent).toContain("refreshed source state");
    click("More inputs");
    expect(container.textContent).toContain("task:input-b: required v2");
    expect(container.textContent).not.toContain("task:input-a: required v2");
    click("More findings");
    expect(container.textContent).toContain("Check the validator outside the status window");
    click("Browse project archive");
    click("Refresh current context");
    expect(container.textContent).toContain("Refreshed archived report");
    click("Include closed work");
    expect(container.textContent).toContain("First archived work · closed");
    click("More work · 1");
    click("Second archived work · closed · v7");
    expect(container.textContent).toContain("Report task:second");
    expect(container.textContent).toContain("Inputs read: Current");
    click("Source: task:second @ 7");
    expect(container.textContent).toContain("Exact source revision 7");
  });
});
