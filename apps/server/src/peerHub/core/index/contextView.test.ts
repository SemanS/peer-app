import { describe, expect, it } from "@effect/vitest";
import { contextGist, type PeerContextIdentity, type PeerTask } from "@t3tools/contracts";
import { composeContextView, contextArchive, contextPage, outcomeClaim } from "./contextView.ts";

const identity: PeerContextIdentity = {
  backend: "local",
  authority: "local:environment-a",
  environment: "environment-a",
  workspace: "local",
  project: "same-project",
  scope: "task:same-task",
};
const at = "2026-10-26T12:00:00.000Z";
const context = {
  workspace: "local",
  project: "same-project",
  scope: "task:same-task",
  version: 7,
  updatedAt: at,
  bytes: 90,
  text: "# Work\nGist: Explicit result\n## Provides\n- Result with checks\n## Blockers\n- Needs review\n## Next\n- Review changes",
};
const base = {
  identity,
  contexts: [context],
  tasks: [],
  findings: [],
  reads: null,
  availability: "available" as const,
  generatedAt: at,
};
const task = (n: number): PeerTask => ({
  id: String(n),
  title: `Task ${n}`,
  status: n % 2 === 0 ? "done" : "open",
  createdBy: "a@b.test",
  createdAt: at,
  updatedAt: at,
});

describe("current context", () => {
  it("uses one explicit gist and deterministic legacy fallback", () => {
    expect(contextGist("# Heading\n<!-- private\ncomment -->\n- First useful line")).toBe(
      "First useful line",
    );
    expect(contextGist(context.text)).toBe("Explicit result");
    expect(contextGist("## Gist\nChosen summary\n## Next\nGo")).toBe("Chosen summary");
    expect(contextGist("# Empty\n<!-- comment -->")).toBeUndefined();
    expect(contextGist("fallback", "Explicit")).toBe("Explicit");
    expect(contextGist("😀".repeat(200))).toHaveLength(320);
  });
  it("carries source revisions and separates assembly from verification", () => {
    const view = composeContextView(base);
    expect(view.current.outcome[0]?.text).toBe("Result with checks");
    expect(view.current.attention[0]?.text).toBe("Needs review");
    expect(view.current.next[0]?.text).toBe("Review changes");
    expect(view.sources[0]?.revision).toBe("7");
    expect(view.current.outcome[0]?.sourceRefs).toEqual([view.sources[0]?.id]);
    expect(view.verifiedAt).toBeNull();
    expect(view.generatedAt).toBe(at);
    expect(view.inputs.state).toBe("unavailable");
  });
  it("reports one short outcome per source and keeps a mapping whole behind it", () => {
    const mapping = Array.from({ length: 12 }, (_, n) => `- change-${n} → task-${n}`);
    const view = composeContextView({
      ...base,
      contexts: [
        {
          ...context,
          text: [
            "# Import",
            "## Provides",
            "Imported 12 OpenSpec changes into Peer. Every task is open.",
            "",
            ...mapping,
            "## State",
            "| check | result |",
            "| --- | --- |",
            "| briefs | verified |",
          ].join("\n"),
        },
      ],
    });
    expect(view.current.outcome).toHaveLength(1);
    expect(view.current.outcome[0]?.text).toBe(
      "Imported 12 OpenSpec changes into Peer. Every task is open.",
    );
    expect(view.current.outcome[0]?.detail).toBe(
      [...mapping, "", "| check | result |", "| --- | --- |", "| briefs | verified |"].join("\n"),
    );
  });
  it("keeps an outcome summary short and never drops what the keeper wrote", () => {
    const long = `${"First sentence is the result".padEnd(200, " x")}. ${"Then more".padEnd(200, " y")}.`;
    const claim = outcomeClaim([long, "- one"], undefined);
    expect(claim?.text.length).toBeLessThanOrEqual(280);
    expect(claim?.text.endsWith(".")).toBe(true);
    expect(claim?.detail?.startsWith("Then more")).toBe(true);
    expect(claim?.detail).toContain("- one");
    expect(outcomeClaim(["- a → b", "- c → d"], "Renamed two tasks")).toEqual({
      text: "Renamed two tasks",
      detail: "- a → b\n- c → d",
    });
    expect(outcomeClaim(["a → b", "c → d"], undefined)?.text).toBe("2 reported items");
    expect(outcomeClaim(["- Only result"], "gist")).toEqual({ text: "Only result" });
    expect(outcomeClaim([], "gist")).toEqual({ text: "gist" });
    const many = outcomeClaim(
      ["Done.", ...Array.from({ length: 70 }, (_, n) => `- ${n}`)],
      undefined,
    );
    expect(many?.detail?.split("\n")).toHaveLength(62);
    expect(many?.detail).toContain("…and 10 more lines in the source.");
  });
  it("does not equate old-server silence or stale dependencies with complete recovery", () => {
    expect(
      composeContextView({ ...base, reads: { fresh: true, stale: [], reads: [] } }).inputs.state,
    ).toBe("revalidation-required");
    expect(
      composeContextView({
        ...base,
        reads: { fresh: true, stale: [], reads: [], recovery: "complete" },
      }).inputs.state,
    ).toBe("complete");
    const view = composeContextView({
      ...base,
      reads: {
        fresh: false,
        recovery: "complete",
        reads: [
          {
            project: identity.project,
            scope: "task:gone",
            session: "s",
            environment: "a",
            version: 3,
            at,
          },
        ],
        stale: [
          {
            project: identity.project,
            scope: "task:gone",
            readVersion: 3,
            currentVersion: null,
            at,
            updatedAt: null,
          },
        ],
      },
    });
    expect(view.inputs.state).toBe("revalidation-required");
    expect(view.inputs.required[0]?.currentRevision).toBeNull();
  });
  it("preserves explicit unavailable input evidence", () => {
    expect(
      composeContextView({
        ...base,
        reads: { fresh: false, stale: [], reads: [], recovery: "unavailable" },
      }).inputs.state,
    ).toBe("unavailable");
  });
  it("distinguishes empty, disabled and unavailable sources", () => {
    for (const availability of ["empty", "disabled", "unavailable"] as const)
      expect(
        composeContextView({ ...base, contexts: [], availability }).sources[0]?.availability,
      ).toBe(availability);
  });
  it("keeps equal task ids in other authorities and environments distinct", () => {
    const a = composeContextView(base).sources[0]?.id;
    const b = composeContextView({
      ...base,
      identity: { ...identity, authority: "https://other-hub", environment: "environment-b" },
    }).sources[0]?.id;
    expect(a).not.toBe(b);
  });
  it("exposes the full dependency count independently of notification cache limits", () => {
    const reads = Array.from({ length: 35 }, (_, n) => ({
      project: identity.project,
      scope: `task:${n}`,
      session: "s",
      environment: "a",
      version: 3,
      at,
    }));
    const first = composeContextView({
      ...base,
      limit: 10,
      reads: { fresh: true, recovery: "complete", stale: [], reads },
    });
    expect(first.inputs.required).toHaveLength(10);
    expect(first.inputs.coverage.total).toBe(35);
    const second = composeContextView({
      ...base,
      limit: 10,
      inputCursor: first.inputs.coverage.nextCursor!,
      reads: { fresh: true, recovery: "complete", stale: [], reads },
    });
    expect(second.inputs.required[0]).not.toEqual(first.inputs.required[0]);
    expect(second.inputs.coverage.omittedCount).toBe(15);
  });
});

describe("context archive", () => {
  it.each([100, 500, 1000])(
    "pages %i tasks with a small initial payload and closed history on request",
    (count) => {
      const tasks = Array.from({ length: count }, (_, n) => task(n));
      const request = {
        identity: { ...identity, scope: "project-aggregate" },
        tasks,
        contexts: [],
        generatedAt: at,
        availability: "available" as const,
        limit: 20,
        history: true,
      };
      let result = contextArchive(request);
      expect(JSON.stringify(result).length).toBeLessThan(6000);
      expect(result.coverage.total).toBe(count);
      const scopes = new Set(result.entries.map((entry) => entry.scope));
      while (result.coverage.nextCursor !== null) {
        result = contextArchive({ ...request, cursor: result.coverage.nextCursor });
        for (const entry of result.entries) {
          expect(scopes.has(entry.scope)).toBe(false);
          scopes.add(entry.scope);
        }
      }
      expect(scopes.size).toBe(count);
      expect(contextArchive({ ...request, history: false }).coverage.total).toBe(count / 2);
      expect(
        contextArchive({ ...request, topic: "Task 99" }).entries.every((entry) =>
          entry.title.includes("Task 99"),
        ),
      ).toBe(true);
    },
  );
  it("refuses changed snapshots and cross-project cursors rather than silently omitting rows", () => {
    const first = contextPage([1, 2, 3], "project-a", 1);
    expect(() => contextPage([0, 1, 2, 3], "project-a", 1, first.coverage.nextCursor!)).toThrow(
      "sources changed",
    );
    expect(() => contextPage([1, 2, 3], "project-b", 1, first.coverage.nextCursor!)).toThrow(
      "sources changed",
    );
  });
});
