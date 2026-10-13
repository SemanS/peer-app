import type {
  PeerCoordSession,
  PeerOwnerCall,
  PeerOwnershipProject,
  PeerProject,
  PeerWorkspaceState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import raw from "./ownership.fixtures.json" with { type: "json" };
import {
  callActions,
  callCovers,
  callIsPending,
  effectiveTaskOwner,
  ownedPathChanges,
  ownerActions,
  ownerCallsWaitingOn,
  ownerDecides,
  ownerLine,
  ownerName,
  ownerToAsk,
  pathOwner,
  pendingCallsOn,
  projectOwnership,
  reviewAsks,
  reviewRoute,
  taskOwnerView,
  type ProjectOwnership,
} from "./ownership.ts";

// ---- the Hub's cases ----------------------------------------------------------------------------

interface Map {
  readonly areas: Readonly<Record<string, string>>;
  readonly paths: Readonly<Record<string, string>>;
  readonly decide: ReadonlyArray<string>;
}
/** The shape of the Hub's `fixtures/resolution.json`, which the app keeps byte for byte. */
interface Fixtures {
  readonly version: number;
  readonly taskOwners: ReadonlyArray<{
    readonly name: string;
    readonly scenario: string;
    readonly map: Map;
    readonly members: ReadonlyArray<string>;
    readonly task: { readonly id: string; readonly area: string | null };
    readonly row: { readonly owner: string } | null;
    readonly expect: { readonly owner: string | null; readonly throughArea: boolean };
  }>;
  readonly pathOwners: ReadonlyArray<{
    readonly name: string;
    readonly scenario: string;
    readonly map: Map;
    readonly members: ReadonlyArray<string>;
    readonly path: string;
    readonly expect: {
      readonly owner: string | null;
      readonly pattern: string | null;
      readonly left: boolean;
      readonly decides: boolean;
    };
  }>;
  readonly asks: ReadonlyArray<{
    readonly name: string;
    readonly scenario: string;
    readonly map: Map;
    readonly person: string;
    readonly path: string;
    readonly expect: { readonly ask: string | null };
  }>;
  readonly coverage: ReadonlyArray<{
    readonly name: string;
    readonly scenario: string;
    readonly call: {
      readonly state: string;
      readonly task: string | null;
      readonly session: string;
      readonly environment: string;
      readonly email: string;
      readonly paths: ReadonlyArray<string>;
    };
    readonly session: {
      readonly id: string;
      readonly environment: string;
      readonly email: string;
      readonly task: string | null;
    };
    readonly path: string;
    readonly expect: { readonly covers: boolean };
  }>;
}
const fixtures = raw as unknown as Fixtures;

describe("the Hub's resolution cases", () => {
  it("resolve a task's effective owner as the Hub does, case by case", () => {
    expect(fixtures.version).toBe(1);
    expect(fixtures.taskOwners.length).toBeGreaterThan(0);
    for (const fixture of fixtures.taskOwners) {
      const { area } = fixture.task;
      const found = effectiveTaskOwner(
        area === null ? {} : { area },
        fixture.row,
        fixture.map,
        new Set(fixture.members),
      );
      expect(found?.owner ?? null, `${fixture.name}: owner`).toBe(fixture.expect.owner);
      expect(found?.throughArea ?? false, `${fixture.name}: through its area`).toBe(
        fixture.expect.throughArea,
      );
    }
  });

  it("resolve a path's owner, its pattern, who left and where the owner decides, case by case", () => {
    expect(fixtures.pathOwners.length).toBeGreaterThan(0);
    for (const fixture of fixtures.pathOwners) {
      const found = pathOwner(fixture.map, fixture.path, new Set(fixture.members));
      expect(found?.owner ?? null, `${fixture.name}: owner`).toBe(fixture.expect.owner);
      expect(found?.pattern ?? null, `${fixture.name}: pattern`).toBe(fixture.expect.pattern);
      expect(found?.left ?? false, `${fixture.name}: left`).toBe(fixture.expect.left);
      expect(ownerDecides(fixture.map, fixture.path), `${fixture.name}: decides`).toBe(
        fixture.expect.decides,
      );
    }
  });

  it("decide whom a person's agent has to ask, case by case", () => {
    expect(fixtures.asks.length).toBeGreaterThan(0);
    for (const fixture of fixtures.asks) {
      expect(ownerToAsk(fixture.map, fixture.person, fixture.path) ?? null, fixture.name).toBe(
        fixture.expect.ask,
      );
    }
  });

  it("decide what an owner's call covers for a session, case by case", () => {
    expect(fixtures.coverage.length).toBeGreaterThan(0);
    /** A row of the file without its `task` where it names none, as the app's types have it. */
    const withTask = <T extends { readonly task: string | null }>({ task, ...rest }: T) =>
      task === null ? rest : { ...rest, task };
    for (const fixture of fixtures.coverage) {
      const covers = callCovers(withTask(fixture.call), withTask(fixture.session), fixture.path);
      expect(covers, fixture.name).toBe(fixture.expect.covers);
    }
  });
});

// ---- a project of people --------------------------------------------------------------------------

const ANA = "ana@acme.test";
const BOB = "bob@acme.test";
const CYRIL = "cyril@acme.test";
const EVA = "eva@acme.test";
const DAN = "dan@acme.test";
const NOW = Date.parse("2026-10-12T21:00:00Z");
const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
const minutes = (count: number) => iso(NOW - count * 60_000);
const inDays = (count: number) => iso(NOW + count * 86_400_000);

const MEMBERS: PeerProject["members"] = [
  { email: ANA, name: "Ana" },
  { email: BOB, name: "Bob" },
  { email: CYRIL, name: "Cyril" },
  { email: EVA, name: "Eva" },
];

function call(overrides: Partial<PeerOwnerCall> = {}): PeerOwnerCall {
  return {
    id: "oc-1",
    project: "ordering",
    task: "ord-9",
    session: "claude:b1",
    email: BOB,
    environment: "bob-laptop",
    owner: ANA,
    paths: ["src/payments/fees.ts"],
    reason: "add a refund fee field",
    state: "pending",
    onBehalf: false,
    createdAt: minutes(40),
    updatedAt: minutes(40),
    expiresAt: inDays(6),
    ...overrides,
  };
}

function view(overrides: Partial<PeerOwnershipProject> = {}): PeerOwnershipProject {
  return {
    workspace: "acme",
    project: "ordering",
    at: minutes(0),
    leads: [EVA],
    map: {
      version: 7,
      areas: { Payments: ANA, Menu: CYRIL },
      paths: { "src/payments/**": ANA, "src/payments/refunds/**": BOB, "src/menu/**": CYRIL },
      decide: ["src/payments/**"],
    },
    tasks: {
      "ord-9": {
        project: "ordering",
        task: "ord-9",
        owner: BOB,
        since: minutes(2880),
        reason: "request",
      },
      "ord-14": {
        project: "ordering",
        task: "ord-14",
        owner: CYRIL,
        since: minutes(120),
        by: EVA,
        reason: "named",
      },
    },
    calls: [call()],
    ...overrides,
  };
}

const member = (role: PeerWorkspaceState["role"] = "member") => ({ slug: "acme", role });
const onProject = (role: PeerProject["role"] = "member", members = MEMBERS) => ({
  id: "ordering",
  role,
  members,
});

/** Ownership of the project as `email` looks at it. */
function ownershipFor(
  email: string | null,
  options: {
    readonly view?: PeerOwnershipProject;
    readonly role?: PeerProject["role"];
    readonly workspaceRole?: PeerWorkspaceState["role"];
    readonly members?: PeerProject["members"];
  } = {},
): ProjectOwnership {
  const found = projectOwnership(
    { email, ownership: { projects: [options.view ?? view()] } },
    member(options.workspaceRole),
    onProject(options.role, options.members),
  );
  if (found === undefined) throw new Error("no ownership");
  return found;
}

describe("projectOwnership", () => {
  it("is there only where the status holds a view of the project", () => {
    const here = { email: ANA, ownership: { projects: [view()] } };
    expect(projectOwnership(here, member(), onProject())?.view.map.version).toBe(7);
    expect(projectOwnership({ email: ANA }, member(), onProject())).toBeUndefined();
    expect(
      projectOwnership({ email: ANA, ownership: { projects: [] } }, member(), onProject()),
    ).toBeUndefined();
    expect(projectOwnership(here, { slug: "other", role: "member" }, onProject())).toBeUndefined();
    expect(projectOwnership(here, member(), { ...onProject(), id: "booking" })).toBeUndefined();
  });

  it("knows the people on the project by lower-case address, and who is looking", () => {
    const ownership = ownershipFor("Ana@Acme.test", {
      members: [{ email: "Ana@Acme.test", name: "Ana" }, ...MEMBERS.slice(1)],
    });
    expect(ownership.me).toBe(ANA);
    expect(ownership.people.get(ANA)).toBe("Ana");
    expect(ownershipFor(null).me).toBeNull();
  });

  it("lets leads and admins manage, and a member only read", () => {
    expect(ownershipFor(EVA, { role: "lead" }).canManage).toBe(true);
    expect(ownershipFor(ANA, { workspaceRole: "owner" }).canManage).toBe(true);
    expect(ownershipFor(ANA, { workspaceRole: "admin" }).canManage).toBe(true);
    expect(ownershipFor(BOB).canManage).toBe(false);
  });

  it("names a person as the project does, or by the start of their address", () => {
    const ownership = ownershipFor(ANA);
    expect(ownerName(ownership, BOB)).toBe("Bob");
    expect(ownerName(ownership, DAN)).toBe("Dan");
    expect(ownerName(ownership, "mary.jane@acme.test")).toBe("Mary");
  });
});

describe("taskOwnerView", () => {
  const task = (id: string, area?: string) => ({ id, ...(area === undefined ? {} : { area }) });

  it("shows a task's own owner with why, since when and who made it", () => {
    const owner = taskOwnerView(ownershipFor(ANA), task("ord-14", "Menu"));
    expect(owner).toEqual({
      email: CYRIL,
      name: "Cyril",
      mine: false,
      throughArea: undefined,
      reason: "named",
      since: minutes(120),
      by: "Eva",
    });
    expect(taskOwnerView(ownershipFor(BOB), task("ord-9", "Payments"))?.mine).toBe(true);
  });

  it("shows the owner of the area for a task with none of its own, and says so", () => {
    const owner = taskOwnerView(ownershipFor(ANA), task("ord-16", "Payments"));
    expect(owner).toEqual({
      email: ANA,
      name: "Ana",
      mine: true,
      throughArea: "Payments",
      reason: undefined,
      since: undefined,
      by: undefined,
    });
  });

  it("shows nobody for a task outside every owned area, or whose owners left", () => {
    expect(taskOwnerView(ownershipFor(ANA), task("ord-20"))).toBeUndefined();
    expect(taskOwnerView(ownershipFor(ANA), task("ord-20", "Orders"))).toBeUndefined();
    const left = ownershipFor(EVA, { members: MEMBERS.filter(({ email }) => email !== BOB) });
    // Bob left: ord-9 has no owner of its own, and Payments is Ana's.
    expect(taskOwnerView(left, task("ord-9", "Payments"))?.email).toBe(ANA);
    expect(taskOwnerView(left, task("ord-9"))).toBeUndefined();
    expect(taskOwnerView(undefined, task("ord-9", "Payments"))).toBeUndefined();
  });

  it("says what a card says of its owner", () => {
    const ownership = ownershipFor(ANA);
    expect(ownerLine(taskOwnerView(ownership, task("ord-9", "Payments")))).toBe("Owner Bob");
    expect(ownerLine(taskOwnerView(ownershipFor(BOB), task("ord-9", "Payments")))).toBe(
      "Owner Bob (you)",
    );
    expect(ownerLine(taskOwnerView(ownership, task("ord-16", "Payments")))).toBe(
      "Owned through Payments · you",
    );
    expect(ownerLine(taskOwnerView(ownershipFor(BOB), task("ord-16", "Payments")))).toBe(
      "Owned through Payments · Ana",
    );
    expect(ownerLine(undefined)).toBe("No owner");
  });
});

describe("who may change an owner", () => {
  const task = (id: string, area?: string) => ({ id, ...(area === undefined ? {} : { area }) });
  const actions = (email: string, id: string, options: Parameters<typeof ownershipFor>[1] = {}) => {
    const ownership = ownershipFor(email, options);
    return ownerActions(ownership, taskOwnerView(ownership, task(id, "Payments")));
  };

  it("lets leads and admins name or clear it, and its owner hand it over or give it back", () => {
    expect(actions(EVA, "ord-9", { role: "lead" })).toEqual({
      set: true,
      handOver: false,
      giveBack: false,
    });
    expect(actions(ANA, "ord-9", { workspaceRole: "admin" }).set).toBe(true);
    expect(actions(BOB, "ord-9")).toEqual({ set: false, handOver: true, giveBack: true });
  });

  it("leaves a member who owns nothing, or only through an area, with nothing to change", () => {
    expect(actions(CYRIL, "ord-9")).toEqual({ set: false, handOver: false, giveBack: false });
    // Ana owns ord-16 through Payments only: there is no row of hers to hand over.
    expect(actions(ANA, "ord-16")).toEqual({ set: false, handOver: false, giveBack: false });
    expect(ownerActions(undefined, undefined)).toEqual({
      set: false,
      handOver: false,
      giveBack: false,
    });
  });
});

describe("reviewRoute", () => {
  const route = (
    email: string | null,
    options: Parameters<typeof ownershipFor>[1] = {},
    id = "ord-9",
  ) => {
    const ownership = ownershipFor(email, options);
    return reviewRoute(ownership, taskOwnerView(ownership, { id, area: "Orders" }));
  };

  it("asks the owner only", () => {
    expect(route(BOB)).toEqual({ audience: "owner", forMe: true, names: ["Bob"] });
    expect(route(ANA)).toEqual({ audience: "owner", forMe: false, names: ["Bob"] });
    // The leads do not see a review that has an owner.
    expect(route(EVA, { role: "lead" }).forMe).toBe(false);
  });

  it("asks the project's leads where nobody owns the task", () => {
    expect(route(EVA, { role: "lead" }, "ord-20")).toEqual({
      audience: "leads",
      forMe: true,
      names: ["Eva"],
    });
    expect(route(ANA, {}, "ord-20")).toEqual({ audience: "leads", forMe: false, names: ["Eva"] });
  });

  it("asks every member where the project has no leads, or its leads left", () => {
    const noLeads = { view: view({ leads: [] }) };
    expect(route(ANA, noLeads, "ord-20")).toEqual({ audience: "everyone", forMe: true, names: [] });
    const gone = { members: MEMBERS.filter(({ email }) => email !== EVA) };
    expect(route(ANA, gone, "ord-20").audience).toBe("everyone");
  });

  it("asks everyone while there is no ownership to say otherwise", () => {
    expect(reviewRoute(undefined, undefined)).toEqual({
      audience: "everyone",
      forMe: true,
      names: [],
    });
  });
});

describe("owner's calls waiting on a person", () => {
  const waiting = (email: string, options: Parameters<typeof ownershipFor>[1] = {}) =>
    ownerCallsWaitingOn(ownershipFor(email, options), email, NOW).map(
      ({ call: { id }, onBehalf }) => `${id}${onBehalf ? " for the owner" : ""}`,
    );

  it("waits on the owner, and on nobody else", () => {
    expect(waiting(ANA)).toEqual(["oc-1"]);
    expect(waiting(CYRIL)).toEqual([]);
    expect(waiting(EVA, { role: "lead" })).toEqual([]);
  });

  it("is never the decision of the person whose agent opened it", () => {
    // Ana owns the path and her own agent asked: nobody decides their own call.
    const own = view({ calls: [call({ email: ANA, owner: ANA })] });
    expect(waiting(ANA, { view: own })).toEqual([]);
    // A lead who asked an owner who left cannot decide it either.
    const asked = view({ calls: [call({ email: EVA, owner: DAN })] });
    expect(waiting(EVA, { view: asked, role: "lead" })).toEqual([]);
  });

  it("waits on the project's leads when the owner left", () => {
    const orphaned = view({ calls: [call({ owner: DAN })] });
    expect(waiting(EVA, { view: orphaned, role: "lead" })).toEqual(["oc-1 for the owner"]);
    expect(waiting(CYRIL, { view: orphaned })).toEqual([]);
    expect(waiting(ANA, { view: orphaned })).toEqual([]);
  });

  it("is a call that is pending, by the clock and not by when the Hub made its view", () => {
    const states = ["accepted", "declined", "withdrawn", "expired", "superseded"].map((state, i) =>
      call({ id: `oc-${i}`, state }),
    );
    expect(waiting(ANA, { view: view({ calls: states }) })).toEqual([]);
    const lapsed = view({ calls: [call({ expiresAt: minutes(1) })] });
    expect(waiting(ANA, { view: lapsed })).toEqual([]);
    expect(callIsPending(call({ expiresAt: minutes(-1) }), NOW)).toBe(true);
    expect(callIsPending(call({ expiresAt: minutes(0) }), NOW)).toBe(false);
  });

  it("lists the calls still pending on a task", () => {
    const ownership = ownershipFor(ANA, {
      view: view({
        calls: [
          call({ id: "oc-1" }),
          call({ id: "oc-2", task: "ord-15" }),
          call({ id: "oc-3", state: "declined" }),
          call({ id: "oc-4", task: undefined }),
        ],
      }),
    });
    expect(pendingCallsOn(ownership, "ord-9", NOW).map(({ id }) => id)).toEqual(["oc-1"]);
    expect(pendingCallsOn(undefined, "ord-9", NOW)).toEqual([]);
  });
});

describe("who may decide or withdraw a call", () => {
  const actions = (email: string, options: Parameters<typeof ownershipFor>[1] = {}, c = call()) =>
    callActions(ownershipFor(email, options), c, NOW);

  it("lets the owner decide, and a lead or an admin decide for them", () => {
    expect(actions(ANA)).toEqual({ decide: "owner", withdraw: false });
    expect(actions(EVA, { role: "lead" })).toEqual({ decide: "on-behalf", withdraw: false });
    expect(actions(CYRIL, { workspaceRole: "admin" }).decide).toBe("on-behalf");
    expect(actions(CYRIL).decide).toBeUndefined();
  });

  it("lets the person whose agent asked take it back, and never decide it", () => {
    expect(actions(BOB)).toEqual({ decide: undefined, withdraw: true });
    // A lead who asked cannot decide their own call.
    expect(actions(BOB, { role: "lead" })).toEqual({ decide: undefined, withdraw: true });
  });

  it("offers nothing once a call is decided, or has run out", () => {
    for (const state of ["accepted", "declined", "withdrawn", "expired"]) {
      expect(actions(ANA, {}, call({ state })), state).toEqual({
        decide: undefined,
        withdraw: false,
      });
    }
    expect(actions(BOB, {}, call({ expiresAt: minutes(1) })).withdraw).toBe(false);
  });
});

describe("whom an agent has to ask", () => {
  const map = view().map;

  it("is the owner of an owner-decides path, when the owner is somebody else", () => {
    expect(ownerToAsk(map, BOB, "src/payments/fees.ts")).toBe(ANA);
    expect(ownerToAsk(map, ANA, "src/payments/fees.ts")).toBeUndefined();
    // The deeper pattern is Bob's, but the owner decides only where the Hub's list says so.
    expect(ownerToAsk(map, ANA, "src/payments/refunds/api.ts")).toBe(BOB);
  });

  it("is nobody for a path nobody owns or where the owner does not decide", () => {
    expect(ownerToAsk(map, BOB, "docs/readme.md")).toBeUndefined();
    expect(ownerToAsk(map, BOB, "src/menu/photos.ts")).toBeUndefined();
    expect(ownerToAsk({ ...map, decide: ["docs/**"] }, BOB, "docs/readme.md")).toBeUndefined();
  });

  it("is still the owner who left, whom the leads answer for", () => {
    const orphaned = { ...map, paths: { "src/payments/**": DAN } };
    expect(ownerToAsk(orphaned, BOB, "src/payments/fees.ts")).toBe(DAN);
  });
});

describe("what covers a change", () => {
  const session = { id: "claude:b1", email: BOB, environment: "bob-laptop", task: "ord-9" };

  it("is an accepted call about the session's task that names the path", () => {
    const accepted = call({ state: "accepted" });
    expect(callCovers(accepted, session, "src/payments/fees.ts")).toBe(true);
    expect(callCovers(accepted, session, "src/payments/limits.ts")).toBe(false);
    for (const state of ["pending", "declined", "withdrawn", "expired"]) {
      expect(callCovers(call({ state }), session, "src/payments/fees.ts"), state).toBe(false);
    }
    // Any session on the call's task, not only the one that asked.
    expect(callCovers(accepted, { ...session, id: "codex:b2" }, "src/payments/fees.ts")).toBe(true);
    expect(callCovers(accepted, { ...session, task: "ord-15" }, "src/payments/fees.ts")).toBe(
      false,
    );
  });

  it("covers what a named directory holds", () => {
    const directory = call({ state: "accepted", paths: ["src/payments/"] });
    expect(callCovers(directory, session, "src/payments/fees.ts")).toBe(true);
    expect(callCovers(directory, session, "src/payments/refunds/api.ts")).toBe(true);
    expect(callCovers(directory, session, "src/paymentsx/a.ts")).toBe(false);
    const file = call({ state: "accepted", paths: ["src/payments"] });
    expect(callCovers(file, session, "src/payments/fees.ts")).toBe(false);
  });

  it("covers, for a call on no task, that very session and no other", () => {
    const loose = call({ state: "accepted", task: undefined });
    const bare = { ...session, task: undefined };
    expect(callCovers(loose, bare, "src/payments/fees.ts")).toBe(true);
    expect(callCovers(loose, { ...bare, id: "claude:b9" }, "src/payments/fees.ts")).toBe(false);
    expect(callCovers(loose, { ...bare, environment: "bob-desktop" }, "src/payments/fees.ts")).toBe(
      false,
    );
    expect(callCovers(loose, { ...bare, email: CYRIL }, "src/payments/fees.ts")).toBe(false);
  });
});

describe("changes in other people's paths", () => {
  const session = (overrides: Partial<PeerCoordSession>): PeerCoordSession => ({
    id: "claude:b1",
    workspace: "acme",
    project: "ordering",
    email: BOB,
    environment: "bob-laptop",
    label: "Do not read this title",
    task: "ord-9",
    status: "working",
    files: [],
    claims: [],
    local: false,
    ...overrides,
  });
  const noCalls = view({ calls: [] });

  it("finds what another person's agent changed in an owned path, and what waits for a call", () => {
    const ownership = ownershipFor(ANA, { view: noCalls });
    const changes = ownedPathChanges(
      ownership,
      [session({ files: ["src/payments/fees.ts", "src/menu/photos.ts", "docs/readme.md"] })],
      NOW,
    );
    expect(changes).toEqual([
      {
        person: BOB,
        task: "ord-9",
        path: "src/payments/fees.ts",
        owner: ANA,
        pattern: "src/payments/**",
        decides: true,
        waitsForCall: true,
        asked: false,
      },
      {
        person: BOB,
        task: "ord-9",
        path: "src/menu/photos.ts",
        owner: CYRIL,
        pattern: "src/menu/**",
        decides: false,
        waitsForCall: false,
        asked: false,
      },
    ]);
  });

  it("knows whether the agent asked, and stops waiting once an accepted call covers the change", () => {
    const files = [session({ files: ["src/payments/fees.ts"] })];
    // Bob's agent asked, and the call still waits for Ana.
    const asked = ownedPathChanges(ownershipFor(ANA), files, NOW)[0];
    expect(asked).toMatchObject({ decides: true, waitsForCall: true, asked: true });
    // A call that lapsed, or was declined, is no ask.
    const lapsed = view({ calls: [call({ expiresAt: minutes(1) })] });
    expect(ownedPathChanges(ownershipFor(ANA, { view: lapsed }), files, NOW)[0]?.asked).toBe(false);
    const declined = view({ calls: [call({ state: "declined" })] });
    expect(ownedPathChanges(ownershipFor(ANA, { view: declined }), files, NOW)[0]).toMatchObject({
      waitsForCall: true,
      asked: false,
    });
    // An accepted call covers it.
    const accepted = view({ calls: [call({ state: "accepted" })] });
    expect(ownedPathChanges(ownershipFor(ANA, { view: accepted }), files, NOW)[0]).toMatchObject({
      decides: true,
      waitsForCall: false,
      asked: false,
    });
  });

  it("says nothing of the owner's own agents, other projects, or paths that are claimed only", () => {
    const ownership = ownershipFor(ANA, { view: noCalls });
    const sessions = [
      session({ email: ANA, files: ["src/payments/fees.ts"] }),
      session({ project: "booking", files: ["src/payments/fees.ts"] }),
      session({ workspace: "other", files: ["src/payments/fees.ts"] }),
      session({ claims: ["src/payments/fees.ts"] }),
    ];
    expect(ownedPathChanges(ownership, sessions, NOW)).toEqual([]);
  });
});

describe("who a review asks, person by person", () => {
  const people = [ANA, BOB, CYRIL, EVA];
  const asks = (options: Parameters<typeof ownershipFor>[1], id: string) =>
    people.filter((person) => {
      const ownership = ownershipFor(person, options);
      return reviewAsks(ownership, taskOwnerView(ownership, { id, area: "Orders" }), person);
    });

  it("agrees with the route the person looking is given", () => {
    const cases = [
      [{}, "ord-9"],
      [{ view: view({ tasks: {} }) }, "ord-9"],
      [{ view: view({ leads: [EVA, CYRIL], tasks: {} }) }, "ord-9"],
      [{ view: view({ leads: [], tasks: {} }) }, "ord-9"],
    ] as const;
    for (const [options, id] of cases) {
      const routed = people.filter((person) => {
        const ownership = ownershipFor(person, options);
        return reviewRoute(ownership, taskOwnerView(ownership, { id, area: "Orders" })).forMe;
      });
      expect(routed).toEqual(asks(options, id));
    }
    expect(asks({}, "ord-9")).toEqual([BOB]);
    expect(asks({ view: view({ tasks: {} }) }, "ord-9")).toEqual([EVA]);
    expect(asks({ view: view({ leads: [EVA, CYRIL], tasks: {} }) }, "ord-9")).toEqual([CYRIL, EVA]);
    expect(asks({ view: view({ leads: [], tasks: {} }) }, "ord-9")).toEqual(people);
  });
});
