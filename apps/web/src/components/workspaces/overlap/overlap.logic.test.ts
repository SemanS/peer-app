import type { PeerHubStatus, PeerOverlap } from "@t3tools/contracts";
import { PEER_LOCAL_WORKSPACE, PERSON_OVERLAP_RESOLUTION } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  decideLine,
  overlapAsker,
  overlapConversation,
  overlapMissingLine,
  overlapSides,
  overlapState,
} from "./overlap.logic";

const status = {
  email: "you@acme.test",
  workspaces: [
    {
      slug: "acme",
      projects: [
        {
          project: {
            id: "booking",
            members: [
              { email: "you@acme.test", name: "You" },
              { email: "eva@acme.test", name: "Eva" },
            ],
          },
          work: {
            tasks: [
              { id: "krk-515", key: "KRK-515", title: "Fix failing GitHub pipelines" },
              { id: "bkg-812", key: "BKG-812", title: "Split Payments" },
            ],
          },
        },
      ],
    },
  ],
  coordination: {
    sessions: [
      {
        id: "claude:mine",
        workspace: "acme",
        project: "booking",
        email: "you@acme.test",
        label: "Fix pipelines",
        task: "krk-515",
        status: "blocked",
        files: ["payments/webhooks.ts", "ci/build.yml"],
        claims: [],
        local: true,
      },
      {
        id: "claude:eva",
        workspace: "acme",
        project: "booking",
        email: "eva@acme.test",
        label: "Split payments",
        task: "bkg-812",
        status: "blocked",
        files: [],
        claims: ["payments/"],
        local: false,
      },
    ],
  },
} as unknown as PeerHubStatus;

const overlap: PeerOverlap = {
  id: "o1",
  workspace: "acme",
  project: "booking",
  sessions: ["claude:mine", "claude:eva"],
  files: ["payments/webhooks.ts"],
  state: "open",
  notes: [
    {
      id: "n3",
      email: "you@acme.test",
      text: "Eva's agent: confirm the split so both of you can continue.",
      at: "2026-10-10T10:03:00Z",
    },
    {
      id: "n1",
      session: "claude:mine",
      email: "you@acme.test",
      text: "I need verifySignature() to read the raw body.",
      at: "2026-10-10T10:01:00Z",
    },
    {
      id: "n2",
      session: "claude:eva",
      email: "eva@acme.test",
      text: "The payload shape is final in task context v7.",
      at: "2026-10-10T10:02:00Z",
    },
  ],
  updatedAt: "2026-10-10T10:03:00Z",
};

describe("an overlap's sides", () => {
  it("names local participants without inventing another person or requiring a Hub account", () => {
    const localStatus = {
      ...status,
      email: null,
      signedIn: false,
      workspaces: [],
      coordination: {
        ...status.coordination,
        sessions: status.coordination.sessions.map((s) => ({
          ...s,
          workspace: PEER_LOCAL_WORKSPACE,
          email: "local",
        })),
      },
    };
    const localOverlap = {
      ...overlap,
      workspace: PEER_LOCAL_WORKSPACE,
      notes: overlap.notes.map((note) => ({ ...note, email: "local" })),
    };
    expect(
      overlapSides(localStatus, localOverlap).every((s) => s.mine && s.name === "Your agent"),
    ).toBe(true);
    expect(overlapConversation(localStatus, localOverlap).map((entry) => entry.who)).toEqual([
      "Your agent",
      "Your agent",
      "You",
    ]);
    expect(overlapAsker(localStatus.coordination, localOverlap)).toBe("computer");
  });

  it("names whose agent each is, its task and what it changes of the overlap's files", () => {
    const [mine, eva] = overlapSides(status, overlap);
    expect(mine).toMatchObject({
      name: "Your agent",
      mine: true,
      on: "KRK-515 · Fix failing GitHub pipelines",
      files: ["payments/webhooks.ts"],
      claims: [],
    });
    expect(eva).toMatchObject({
      name: "Eva’s agent",
      person: "Eva",
      mine: false,
      on: "BKG-812 · Split Payments",
      files: [],
      claims: ["payments/"],
    });
  });

  it("keeps a side whose agent stopped reporting", () => {
    const [, gone] = overlapSides(status, { ...overlap, sessions: ["claude:mine", "claude:old"] });
    expect(gone).toMatchObject({ name: "An agent no longer at work", gone: true });
  });

  it("puts your side first whichever agent the hub listed first", () => {
    const sides = overlapSides(status, { ...overlap, sessions: ["claude:eva", "claude:mine"] });
    expect(sides.map((side) => side.mine)).toEqual([true, false]);
  });
});

describe("the conversation between the agents", () => {
  it("orders the notes, marks a person's as a nudge and the resolution as the agreement", () => {
    const resolved = {
      ...overlap,
      state: "resolved" as const,
      closer: "claude:eva",
      resolution: "Agreed. I keep buildPayload(); verifySignature() is yours.",
      updatedAt: "2026-10-10T10:04:00Z",
    };
    expect(
      overlapConversation(status, resolved).map((entry) => [entry.kind, entry.who, entry.at]),
    ).toEqual([
      ["note", "Your agent", "2026-10-10T10:01:00Z"],
      ["note", "Eva’s agent", "2026-10-10T10:02:00Z"],
      ["nudge", "You", "2026-10-10T10:03:00Z"],
      ["agreement", "Eva’s agent", "2026-10-10T10:04:00Z"],
    ]);
  });

  it("gives the agreement to the agent that closed it, once, not to the one asked to", () => {
    // The Hub also keeps the resolution as the closing agent's note; the agreement stands for it.
    const resolved = {
      ...overlap,
      state: "resolved" as const,
      closer: "claude:mine",
      resolution: "Eva changes webhooks.ts first",
      notes: [
        ...overlap.notes,
        {
          id: "n4",
          session: "claude:eva",
          email: "eva@acme.test",
          text: "Resolved: Eva changes webhooks.ts first",
          at: "2026-10-10T10:04:00Z",
        },
      ],
      updatedAt: "2026-10-10T10:04:00Z",
    };
    const entries = overlapConversation(status, resolved);
    expect(entries.map((entry) => [entry.kind, entry.who])).toEqual([
      ["note", "Your agent"],
      ["note", "Eva’s agent"],
      ["nudge", "You"],
      ["agreement", "Eva’s agent"],
    ]);
    expect(entries.filter((entry) => entry.text.includes("webhooks.ts first"))).toHaveLength(1);
  });

  it("says a person closed it when they did, and has no agreement while it is open", () => {
    expect(overlapConversation(status, overlap).some((entry) => entry.kind === "agreement")).toBe(
      false,
    );
    const closed = overlapConversation(status, {
      ...overlap,
      state: "resolved",
      resolution: PERSON_OVERLAP_RESOLUTION,
    }).at(-1);
    expect(closed).toMatchObject({ kind: "agreement", who: "Closed in Peer" });
  });

  it("puts each phase in a tone", () => {
    expect(overlapState("settled")).toEqual({ label: "Closed", tone: "delivery" });
    expect(overlapState("settled", PERSON_OVERLAP_RESOLUTION).label).toBe("Closed in Peer");
    expect(overlapState("requested").tone).toBe("coordination");
    expect(overlapState("decide").tone).toBe("needs");
  });
});

describe("who asks the person before the agents settle an overlap", () => {
  const coordination = (extra: object = {}) =>
    ({
      policy: "ask",
      policies: { acme: { booking: "ask" } },
      ...extra,
    }) as unknown as PeerHubStatus["coordination"];
  const place = { workspace: "acme", project: "booking" };

  it("is the project when the Hub says it decided, or when the project sets the policy itself", () => {
    expect(
      overlapAsker(coordination({ policies: { acme: {} } }), {
        ...place,
        decision: { policy: "ask", source: "project", pattern: "docs/**" },
      }),
    ).toBe("project");
    expect(overlapAsker(coordination(), place)).toBe("project");
  });

  it("is this computer where the project sets none, and says nothing of the project then", () => {
    expect(overlapAsker(coordination(), { ...place, project: "camp" })).toBe("computer");
    // The Hub recorded the computer's default.
    expect(
      overlapAsker(coordination({ policies: { acme: {} } }), {
        ...place,
        decision: { policy: "ask", source: "client" },
      }),
    ).toBe("computer");
    expect(decideLine("computer")).toBe("Your agent asks you before it settles this overlap.");
    expect(decideLine("computer")).not.toContain("project");
  });

  it("claims neither while it cannot tell", () => {
    expect(overlapAsker(coordination({ policies: undefined }), place)).toBe("unknown");
    expect(decideLine("project")).toBe(
      "This project asks you before its agents settle an overlap.",
    );
    expect(decideLine("unknown")).not.toMatch(/project|Your agent/);
  });
});

describe("a page with no overlap to show", () => {
  it("says it is closed, unless this computer is not looking at overlaps at all", () => {
    expect(overlapMissingLine(true)).toContain("This overlap is closed");
    expect(overlapMissingLine(false)).toContain("coordination is off");
    expect(overlapMissingLine(false)).not.toContain("closed");
  });
});
