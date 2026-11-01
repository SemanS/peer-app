import { RegistryContext } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  ProjectId,
  type AgentSessionProjectCandidate,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { act, render, type Screen } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
type Project = { id: ProjectId; environmentId: EnvironmentId; workspaceRoot: string };
type CreateProjectInput = {
  environmentId: EnvironmentId;
  input: { projectId: ProjectId; workspaceRoot: string };
};
const state = vi.hoisted(() => ({
  selectedEnvironment: "primary",
  sessions: new Map<string, unknown>(),
  projects: null as unknown,
  providers: null as unknown,
  config: null as unknown,
  candidates: [] as AgentSessionProjectCandidate[],
  createProject: vi.fn(),
  importThreads: vi.fn(),
  refreshProviders: vi.fn(),
  connectPairing: vi.fn(),
  completeOnboarding: vi.fn(),
  waitForProject: vi.fn(),
  onDone: vi.fn(),
  scan: vi.fn(),
  refreshScan: vi.fn(),
}));

// Session grants come from per-test atoms so a test can revoke or regrant mid-flow; the
// real scope checks in ~/state/session read them through the app registry, which the
// wizard is also rendered with.
vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createEnvironmentSessionAtoms: ((runtime: never) => ({
      ...actual.createEnvironmentSessionAtoms(runtime),
      sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id),
    })) as never,
  };
});
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => false,
}));
vi.mock(import("../../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: () => state.completeOnboarding(),
}));
vi.mock(import("../../state/environments"), async (original) => {
  const environment = (environmentId: string) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" },
    entry: { enabled: true, target: { _tag: "DirectConnectionTarget" } },
  });
  const primary = environment("primary");
  return {
    ...(await original()),
    usePrimaryEnvironment: (() => primary) as never,
    useEnvironments: (() => ({ environments: [environment(state.selectedEnvironment)] })) as never,
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => state.providers) as never,
      configValueAtom: (() => state.config) as never,
      refreshProviders: "refreshProviders" as never,
    },
  };
});
vi.mock(import("../../state/entities"), async (original) => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    ...(await original()),
    useProjects: (() => useAtomValue(state.projects as Atom.Atom<Project[]>)) as never,
    readProjects: (() => appAtomRegistry.get(state.projects as Atom.Atom<Project[]>)) as never,
    waitForProject: ((ref: unknown) => state.waitForProject(ref)) as never,
  };
});
vi.mock(import("../../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "createProject" } as never,
}));
vi.mock(import("../../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "importThreads" as never,
}));
vi.mock(import("../../onboarding/useProjectScans"), async (original) => ({
  ...(await original()),
  useProjectScans: (ids: readonly EnvironmentId[]) =>
    ids.map((environmentId) => {
      state.scan({ environmentId });
      return {
        environmentId,
        data: { candidates: state.candidates, truncated: false } as never,
        isPending: false,
        error: null,
        refresh: state.refreshScan,
      };
    }),
}));
vi.mock(import("../../connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: "connectPairing" as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((
    command: "createProject" | "importThreads" | "refreshProviders" | "connectPairing",
  ) => state[command]) as never,
}));
vi.mock(import("../settings/ChatGptWelcomeCoordinator"), async (original) => ({
  ...(await original()),
  ChatGptWelcomeCoordinator: () => <></>,
}));

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { WelcomeWizard } from "./WelcomeWizard";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const permissionMessage = "This connection cannot import projects or thread history.";

function session(scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState {
  return {
    authenticated: true,
    scopes: [AuthOrchestrationReadScope, ...scopes],
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["bearer-access-token"],
      sessionCookieName: "t3_session",
    },
  };
}

function sessionAtom(environmentId: EnvironmentId) {
  return state.sessions.get(environmentId) as Atom.Writable<SessionResult>;
}

function projectsAtom() {
  return state.projects as Atom.Writable<ReadonlyArray<Project>>;
}

function setGrant(environmentId: EnvironmentId, allowed: boolean) {
  appAtomRegistry.set(
    sessionAtom(environmentId),
    AsyncResult.success(session(allowed ? [AuthOrchestrationOperateScope] : [])),
  );
}

function candidate(path: string): AgentSessionProjectCandidate {
  return {
    path,
    title: path.split("/").at(-1)!,
    sources: ["codex"],
    threadCount: 10,
    lastActiveAt: "2026-09-05T00:00:00.000Z",
    alreadyImported: false,
  };
}

function recordProject({ environmentId, input }: CreateProjectInput) {
  appAtomRegistry.set(projectsAtom(), [
    ...appAtomRegistry.get(projectsAtom()),
    { id: input.projectId, environmentId, workspaceRoot: input.workspaceRoot },
  ]);
  return AsyncResult.success(undefined);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function pageText() {
  return document.body.textContent ?? "";
}

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function click(label: string) {
  const target = button(label);
  expect(target.disabled).toBe(false);
  await act(async () => target.click());
}

function checkboxes() {
  return [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')];
}

function projectCheckboxes() {
  return checkboxes().slice(0, -1);
}

function historyCheckbox() {
  return checkboxes().at(-1)!;
}

async function mountImport(screen: Screen, remote = false) {
  state.selectedEnvironment = remote ? "remote" : "primary";
  await screen.rerender(
    <RegistryContext.Provider value={appAtomRegistry}>
      <WelcomeWizard localAvailable={!remote} onDone={state.onDone} />
    </RegistryContext.Provider>,
  );
  // Without a local server the wizard opens on Connect; with one, on how Peer will be used.
  await click(remote ? "Continue" : "Work on this computer");
  await click("Continue");
  expect(pageText()).toContain("Choose your first project");
}

// The most recent project starts selected and its conversations stay out until asked for.
async function chooseBothWithHistory() {
  await click("Select all");
  await act(async () => historyCheckbox().click());
}

function setup() {
  // Only projects active in the last 30 days start selected.
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-05T00:01:00.000Z"));
  for (const id of [primaryId, remoteId]) {
    state.sessions.set(
      id,
      Atom.make<SessionResult>(AsyncResult.success(session([AuthOrchestrationOperateScope]))).pipe(
        Atom.keepAlive,
      ),
    );
  }
  state.projects = Atom.make<ReadonlyArray<Project>>([]).pipe(Atom.keepAlive);
  state.providers = Atom.make<ReadonlyArray<never>>([]).pipe(Atom.keepAlive);
  state.config = Atom.make(null).pipe(Atom.keepAlive);
  state.candidates = [candidate("/projects/first"), candidate("/projects/second")];
  state.createProject
    .mockReset()
    .mockImplementation(async (input: CreateProjectInput) => recordProject(input));
  state.importThreads
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ importedCount: 1, skippedCount: 0 }));
  state.refreshProviders.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.connectPairing.mockReset().mockResolvedValue(AsyncResult.success(remoteId));
  state.completeOnboarding.mockReset().mockResolvedValue(undefined);
  state.waitForProject.mockReset().mockResolvedValue(undefined);
  state.onDone.mockReset();
  state.scan.mockReset();
  state.refreshScan.mockReset();
  return {
    [Symbol.dispose]() {
      state.sessions.clear();
      clock.mockRestore();
    },
  };
}

it("keeps scanning, choosing and skipping available to a paired read-only environment", async () => {
  using _setup = setup();
  await using screen = await render(null);
  setGrant(remoteId, false);
  await mountImport(screen, true);
  expect(state.scan).toHaveBeenCalledWith(expect.objectContaining({ environmentId: remoteId }));
  expect(pageText()).toContain("/projects/first");
  expect(button("Open 1 project").disabled).toBe(true);
  expect(pageText()).toContain(permissionMessage);
  await click("Choose a project later");
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.completeOnboarding).toHaveBeenCalledOnce();
  expect(state.onDone).toHaveBeenCalledOnce();
});

it("opens the most recent project without copying its conversations", async () => {
  using _setup = setup();
  await using screen = await render(null);
  await mountImport(screen);
  expect(projectCheckboxes().map((box) => box.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
  ]);
  await click("Open 1 project");
  expect(state.createProject).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      input: expect.objectContaining({ workspaceRoot: "/projects/first" }),
    }),
  );
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.onDone).toHaveBeenCalledWith(
    expect.objectContaining({ environmentId: primaryId }),
    undefined,
  );
});

it("finishes setup without landing when the imported project never reaches the client", async () => {
  using _setup = setup();
  await using screen = await render(null);
  // The server accepts the project, but it never shows up in the client's projects.
  state.waitForProject.mockRejectedValue(new Error("The project did not appear."));
  state.completeOnboarding.mockRejectedValueOnce(new Error("offline"));
  await mountImport(screen);

  await click("Open 1 project");
  await vi.waitFor(() => expect(state.completeOnboarding).toHaveBeenCalledOnce());
  // A failed completion hands the step back instead of leaving it importing.
  await vi.waitFor(() => expect(button("Open 1 project").disabled).toBe(false));
  expect(state.onDone).not.toHaveBeenCalled();

  await click("Open 1 project");
  await vi.waitFor(() => expect(state.onDone).toHaveBeenCalledOnce());
  expect(state.onDone.mock.calls[0]?.[0]).toBeUndefined();
});

it("waits for the selected grant and enables import when it arrives", async () => {
  using _setup = setup();
  await using screen = await render(null);
  appAtomRegistry.set(sessionAtom(primaryId), AsyncResult.initial());
  await mountImport(screen);
  await chooseBothWithHistory();
  expect(button("Import 2 projects").disabled).toBe(true);
  await act(async () => setGrant(primaryId, true));
  await click("Import 2 projects");
  expect(state.createProject).toHaveBeenCalledTimes(2);
  expect(state.importThreads).toHaveBeenCalledTimes(2);
  expect(state.onDone).toHaveBeenCalledWith(
    expect.objectContaining({ environmentId: primaryId }),
    undefined,
  );
});

it("preserves selections and denies a click that lands as the paired environment's grant is revoked", async () => {
  using _setup = setup();
  await using screen = await render(null);
  await mountImport(screen, true);
  await chooseBothWithHistory();
  await act(async () => projectCheckboxes()[1]!.click());
  expect(projectCheckboxes()[1]!.getAttribute("aria-checked")).toBe("false");
  const importButton = button("Import 1 project");
  // The click reaches the still-enabled button before React re-renders the revocation.
  await act(async () => {
    setGrant(remoteId, false);
    importButton.click();
  });
  expect(button("Import 1 project").disabled).toBe(true);
  expect(projectCheckboxes()[1]!.getAttribute("aria-checked")).toBe("false");
  expect(pageText()).toContain(permissionMessage);
  expect(state.createProject).not.toHaveBeenCalled();
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.onDone).not.toHaveBeenCalled();

  await act(async () => setGrant(remoteId, true));
  expect(pageText()).not.toContain(permissionMessage);
  await click("Import 1 project");
  expect(state.createProject).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ environmentId: remoteId }),
  );
  expect(state.importThreads).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ environmentId: remoteId }),
  );
});

it("rechecks after project creation and can retry its history without recreating the project", async () => {
  using _setup = setup();
  await using screen = await render(null);
  const creation = deferred<void>();
  state.createProject.mockImplementationOnce(async (input: CreateProjectInput) => {
    await creation.promise;
    return recordProject(input);
  });
  await mountImport(screen);
  await chooseBothWithHistory();
  await click("Import 2 projects");
  expect(state.createProject).toHaveBeenCalledOnce();
  await act(async () => {
    setGrant(primaryId, false);
    creation.resolve();
    await creation.promise;
  });
  expect(state.importThreads).not.toHaveBeenCalled();
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.onDone).not.toHaveBeenCalled();
  expect(pageText()).toContain(permissionMessage);

  await act(async () => setGrant(primaryId, true));
  await click("Import 2 projects");
  expect(state.createProject).toHaveBeenCalledTimes(2);
  expect(state.importThreads).toHaveBeenCalledTimes(2);
  expect(state.onDone).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "rechecks after history import before the next project write (existing: %s)",
  async (existing) => {
    using _setup = setup();
    await using screen = await render(null);
    if (existing) {
      const projectId = ProjectId.make("second-existing");
      state.candidates[1] = { ...state.candidates[1]!, projectId };
      appAtomRegistry.set(projectsAtom(), [
        { id: projectId, environmentId: primaryId, workspaceRoot: "/projects/second" },
      ]);
    }
    const imported = deferred<{ importedCount: number; skippedCount: number }>();
    state.importThreads.mockImplementationOnce(async () =>
      AsyncResult.success(await imported.promise),
    );
    await mountImport(screen);
    await chooseBothWithHistory();
    await click("Import 2 projects");
    expect(state.createProject).toHaveBeenCalledOnce();
    expect(state.importThreads).toHaveBeenCalledOnce();
    await act(async () => {
      setGrant(primaryId, false);
      imported.resolve({ importedCount: 1, skippedCount: 0 });
      await imported.promise;
    });
    expect(state.createProject).toHaveBeenCalledOnce();
    expect(state.importThreads).toHaveBeenCalledOnce();
    expect(state.onDone).not.toHaveBeenCalled();
    expect(pageText()).toContain(permissionMessage);

    await act(async () => setGrant(primaryId, true));
    await click("Import 2 projects");
    expect(state.createProject).toHaveBeenCalledTimes(existing ? 1 : 2);
    expect(state.importThreads).toHaveBeenCalledTimes(2);
    expect(state.onDone).toHaveBeenCalledOnce();
  },
);

it("completes accepted imports when permission is revoked after the final server write", async () => {
  using _setup = setup();
  await using screen = await render(null);
  state.candidates = state.candidates.slice(0, 1);
  const imported = deferred<{ importedCount: number; skippedCount: number }>();
  state.importThreads.mockImplementationOnce(async () =>
    AsyncResult.success(await imported.promise),
  );
  await mountImport(screen);
  await act(async () => historyCheckbox().click());
  await click("Import 1 project");
  await act(async () => {
    setGrant(primaryId, false);
    imported.resolve({ importedCount: 1, skippedCount: 0 });
    await imported.promise;
  });
  expect(state.createProject).toHaveBeenCalledOnce();
  expect(state.importThreads).toHaveBeenCalledOnce();
  expect(state.completeOnboarding).toHaveBeenCalledOnce();
  expect(state.onDone).toHaveBeenCalledOnce();
});
