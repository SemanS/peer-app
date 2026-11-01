import type { ComponentProps } from "react";
import { act, render, stubGlobal, type Screen } from "../../../test/render";
import {
  EnvironmentId,
  ProjectId,
  type PeerHubStatus,
  type PeerProjectState,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  importThreads: vi.fn(),
  createProject: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  join: vi.fn(),
  openProject: vi.fn(),
  confirm: vi.fn(),
  dialogAvailable: true,
  toast: vi.fn(),
  projects: [] as Array<{ id: string; environmentId: string; workspaceRoot: string }>,
  peerHubStatus: null as PeerHubStatus | null,
}));
// A mocked module has only the names its factory returns, and in a browser one missing name stops
// every module importing it from linking. WorkspaceAccess stays real here and its imports reach
// most of the app, so each factory keeps the module's other exports.
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: ((environments: Array<{ environmentId: string }>) =>
    new Set(environments.map((entry) => entry.environmentId))) as never,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/agentSessions"), async (original) => ({
  ...(await original()),
  agentSessionImport: "import" as never,
}));
vi.mock(import("../../localApi"), async (original) => ({
  ...(await original()),
  ensureLocalApi: (() => {
    if (!mocks.dialogAvailable) throw new Error("No dialog host is available.");
    return { dialogs: { confirm: mocks.confirm } };
  }) as never,
}));
vi.mock(import("../../state/projects"), async (original) => ({
  ...(await original()),
  projectEnvironment: { create: "create" } as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: string) =>
    command === "import"
      ? mocks.importThreads
      : command === "create"
        ? mocks.createProject
        : command === "join"
          ? mocks.join
          : command === "open"
            ? mocks.openProject
            : mocks.refresh) as never,
}));
vi.mock(import("../../onboarding/firstRun"), async (original) => ({
  ...(await original()),
  completeOnboarding: (...args: unknown[]) => mocks.complete(...args) as never,
}));
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => mocks.projects) as never,
  readProjects: (() => mocks.projects) as never,
  waitForProject: (() => Promise.resolve()) as never,
}));
vi.mock(import("../../state/environments"), async (original) => {
  const environment = {
    environmentId: "test-env",
    label: "Computer",
    connection: { phase: "connected" },
    serverConfig: {},
    entry: { enabled: true },
  };
  return {
    ...(await original()),
    useEnvironments: (() => ({ environments: [environment] })) as never,
    usePrimaryEnvironment: (() => environment) as never,
  };
});
vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnvironment: {
      ...actual.serverEnvironment,
      providersValueAtom: (() => []) as never,
      configValueAtom: (() => null) as never,
      refreshProviders: "refresh" as never,
      peerHubJoinWorkspace: "join" as never,
      peerHubOpenProject: "open" as never,
    },
  };
});
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAtomValue: (value: unknown) => value,
}));
vi.mock(import("../../onboarding/useProjectScans"), async (original) => ({
  ...(await original()),
  useProjectScans: () =>
    [
      {
        environmentId: "test-env",
        isPending: false,
        error: null,
        refresh: mocks.refresh,
        data: {
          truncated: false,
          candidates: [
            {
              path: "/project",
              title: "project",
              projectId: "test-project",
              threadCount: 29,
              lastActiveAt: new Date().toISOString(),
              sources: ["codex"],
            },
          ],
        },
      },
    ] as never,
}));
vi.mock(import("../../connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: vi.fn() as never,
}));
vi.mock(import("../../state/terminal"), async (original) => ({
  ...(await original()),
  terminalEnvironment: {} as never,
}));
vi.mock(import("../clerk/useT3ConnectAuthPrompt"), async (original) => ({
  ...(await original()),
  useT3ConnectAuthPrompt: vi.fn() as never,
}));
vi.mock(import("../../cloud/publicConfig"), async (original) => ({
  ...(await original()),
  hasCloudPublicConfig: () => false,
}));
vi.mock(import("../ThreadTerminalDrawer"), async (original) => ({
  ...(await original()),
  TerminalViewport: () => <></>,
}));
vi.mock(import("../settings/ChatGptWelcomeCoordinator"), async (original) => ({
  ...(await original()),
  ChatGptWelcomeCoordinator: () => <></>,
}));
vi.mock(import("../settings/CodexSetupSection"), async (original) => ({
  ...(await original()),
  CodexSetupSection: () => <></>,
  AddManagedCodexAccountDialog: () => <></>,
}));
vi.mock(import("../cloud/CloudEnvironmentConnectList"), async (original) => ({
  ...(await original()),
  CloudEnvironmentConnectRows: () => null,
}));
vi.mock(import("../workspaces/WorkspaceAccess"), async (original) => ({
  ...(await original()),
  usePeerHubStatus: () => mocks.peerHubStatus,
}));
vi.mock(import("../ui/toast"), async (original) => ({
  ...(await original()),
  toastManager: { add: mocks.toast, close: vi.fn(), update: vi.fn() } as never,
}));

import { WelcomeWizard } from "./WelcomeWizard";

function setup() {
  vi.clearAllMocks();
  const observer = stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const animations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  mocks.projects = [{ id: "test-project", environmentId: "test-env", workspaceRoot: "/project" }];
  mocks.peerHubStatus = null;
  mocks.complete.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.join.mockResolvedValue({ _tag: "Success", value: null });
  mocks.openProject.mockResolvedValue({ _tag: "Success", value: null });
  mocks.confirm.mockResolvedValue(true);
  mocks.dialogAvailable = true;
  mocks.importThreads.mockResolvedValue({
    _tag: "Success",
    value: { importedCount: 28, skippedCount: 1 },
  });
  return {
    [Symbol.dispose]() {
      observer[Symbol.dispose]();
      if (animations) Object.defineProperty(Element.prototype, "getAnimations", animations);
      else Reflect.deleteProperty(Element.prototype, "getAnimations");
    },
  };
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

// The project starts selected; its conversations come along only when asked for.
async function importTheProject(
  screen: Screen,
  onDone: ComponentProps<typeof WelcomeWizard>["onDone"],
) {
  await screen.rerender(<WelcomeWizard localAvailable onDone={onDone} />);
  await click("Work on this computer");
  await click("Continue");
  const history = [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].at(-1)!;
  await act(async () => history.click());
  await click("Import 1 project");
}

async function openTeamStep(
  screen: Screen,
  onDone: ComponentProps<typeof WelcomeWizard>["onDone"] = vi.fn(),
) {
  await screen.rerender(<WelcomeWizard localAvailable onDone={onDone} />);
  await click("Join or create a team workspace");
}

it("enters the workspace after a partial import and warns after navigation finishes", async () => {
  using _setup = setup();
  await using screen = await render(null);
  let finishNavigation = () => {};
  const navigation = new Promise<void>((resolve) => {
    finishNavigation = resolve;
  });
  const onDone = vi.fn(() => navigation);
  await importTheProject(screen, onDone);
  expect(onDone).toHaveBeenCalledWith(
    {
      environmentId: EnvironmentId.make("test-env"),
      projectId: ProjectId.make("test-project"),
    },
    undefined,
  );
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => finishNavigation());
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
  expect(mocks.toast.mock.invocationCallOrder[0]).toBeGreaterThan(
    onDone.mock.invocationCallOrder[0]!,
  );
});

it.each([
  [0, 0, null],
  [29, 0, null],
  [1, 0, null],
  [0, 1, "1 thread could not be imported."],
  [0, 2, "2 threads could not be imported."],
] as const)(
  "finishes setup with %i imported and %i skipped threads",
  async (importedCount, skippedCount, warning) => {
    using _setup = setup();
    await using screen = await render(null);
    mocks.importThreads.mockResolvedValue({
      _tag: "Success",
      value: { importedCount, skippedCount },
    });
    const onDone = vi.fn();
    await importTheProject(screen, onDone);
    expect(onDone).toHaveBeenCalledOnce();
    if (warning === null && importedCount > 0) {
      expect(mocks.toast).toHaveBeenCalledWith({
        type: "success",
        title: `Imported ${importedCount} ${importedCount === 1 ? "thread" : "threads"}`,
      });
    } else if (warning === null) {
      expect(mocks.toast).not.toHaveBeenCalled();
    } else {
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "warning", description: warning }),
      );
    }
  },
);

it("keeps setup open when saving completion fails and preserves the import warning on retry", async () => {
  using _setup = setup();
  await using screen = await render(null);
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await importTheProject(screen, onDone);
  expect(onDone).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Could not finish setup" }),
  );
  await click("Choose a project later");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.importThreads).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "warning",
      description: "Imported 28 threads. 1 thread could not be imported.",
    }),
  );
});

const SIGNED_OUT: PeerHubStatus = {
  hubUrl: "https://hub.example.test",
  signedIn: false,
  email: null,
  pendingSignIn: null,
  workspaces: [],
  joinable: [],
  workspaceRoot: "/home/ana/Peer",
  environmentId: "test-env",
  agents: { herdr: "not-running", list: [] },
  github: { cli: false, account: null, signIn: null, error: null },
  coordination: {
    enabled: false,
    policy: "coordinate",
    claudeHooks: false,
    logPath: "",
    sessions: [],
    overlaps: [],
    findings: [],
    contexts: [],
    candidates: [],
  },
  sharedThreads: [],
  syncing: false,
  lastSyncAt: null,
  error: null,
};

const TEAM_PROJECT: PeerProjectState = {
  project: {
    id: "app",
    name: "App",
    role: "member",
    members: [],
    repositories: [{ id: "app", url: "https://git.example.test/app.git", branch: "main" }],
    knowledge: { kontext: false, company: false },
    tools: [],
    capacity: { personal: "any", personalHarnesses: [] },
  },
  repositories: [
    {
      id: "app",
      url: "https://git.example.test/app.git",
      branch: "main",
      path: "/home/ana/Peer/app",
      state: "missing",
    },
  ],
  tools: [],
  sharedCapacity: { enabled: false, instanceIds: [] },
  work: { areas: [], tasks: [], threads: [] },
  peers: [],
};

const JOINED: PeerHubStatus = {
  ...SIGNED_OUT,
  signedIn: true,
  email: "ana@acme.test",
  workspaces: [
    {
      slug: "acme",
      name: "Acme",
      role: "member",
      allowedDomains: ["acme.test"],
      currency: "EUR",
      memberName: "Ana",
      companyKnowledge: null,
      projects: [TEAM_PROJECT],
      lastSyncAt: null,
      error: null,
    },
  ],
};

// A clone runs in the background, so the project reaches the list long after the wizard moved on.
it("lands on the team's tasks while the picked project is still cloning", async () => {
  using _setup = setup();
  await using screen = await render(null);
  mocks.projects = [];
  mocks.peerHubStatus = JOINED;
  const onDone = vi.fn();
  await openTeamStep(screen, onDone);
  await click("Continue");
  expect(mocks.openProject).toHaveBeenCalledExactlyOnceWith({
    environmentId: "test-env",
    input: { workspace: "acme", projectId: "app" },
  });
  expect(document.querySelector("h1")?.textContent).toBe("Connect your agents");
  await click("Continue");
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledExactlyOnceWith(undefined, "work");
  expect(document.querySelector("h1")?.textContent).toBe("Connect your agents");
});

it("lands on the team's tasks when a project is open already", async () => {
  using _setup = setup();
  await using screen = await render(null);
  mocks.peerHubStatus = SIGNED_OUT;
  const onDone = vi.fn();
  await openTeamStep(screen, onDone);
  await click("Skip for now");
  await click("Continue");
  expect(onDone).toHaveBeenCalledExactlyOnceWith(undefined, "work");
});

it.each([
  ["skips signing in", SIGNED_OUT, () => click("Skip for now")],
  [
    "picks no project",
    JOINED,
    async () => {
      await act(async () => document.querySelector<HTMLElement>('[role="checkbox"]')!.click());
      await click("Continue");
    },
  ],
] as const)(
  "still offers a first project to someone who %s",
  async (_description, status, leaveTeamStep) => {
    using _setup = setup();
    await using screen = await render(null);
    mocks.projects = [];
    mocks.peerHubStatus = status;
    const onDone = vi.fn();
    await openTeamStep(screen, onDone);
    await leaveTeamStep();
    expect(mocks.openProject).not.toHaveBeenCalled();
    await click("Continue");
    expect(document.querySelector("h1")?.textContent).toBe("Choose your first project");
    expect(onDone).not.toHaveBeenCalled();
  },
);

it("asks for a work email first, then offers the workspaces that address may join", async () => {
  using _setup = setup();
  await using screen = await render(null);
  mocks.peerHubStatus = SIGNED_OUT;
  await openTeamStep(screen);
  expect(document.querySelector("h1")?.textContent).toBe("Join your team");
  expect(document.querySelector("#peer-sign-in-email")).not.toBeNull();

  mocks.peerHubStatus = {
    ...SIGNED_OUT,
    signedIn: true,
    email: "ana@acme.test",
    joinable: [{ slug: "acme", name: "Acme", allowedDomains: ["acme.test"], reason: "domain" }],
  };
  await screen.rerender(<WelcomeWizard localAvailable onDone={vi.fn()} />);
  expect(document.querySelector("h1")?.textContent).toBe("Choose a workspace");
  expect(document.body.textContent).toContain("Anyone with an @acme.test address can join.");

  await click("Skip for now");
  expect(document.querySelector("h1")?.textContent).toBe("Connect your agents");
});

it("leaves the workspace step out without a local server", async () => {
  using _setup = setup();
  await using screen = await render(null);
  await screen.rerender(<WelcomeWizard localAvailable={false} onDone={vi.fn()} />);
  expect(document.querySelector("h1")?.textContent).toBe("Connect your computers");
});

it("offers the company's own workspace, ready to create, when its domain has none", async () => {
  using _setup = setup();
  await using screen = await render(null);
  mocks.peerHubStatus = { ...SIGNED_OUT, signedIn: true, email: "ana@acme.test" };
  mocks.refresh.mockResolvedValue({ _tag: "Success", value: null });
  await openTeamStep(screen);
  expect(document.body.textContent).toContain("Create the Acme workspace");
  await click("Create Acme");
  expect(mocks.refresh).toHaveBeenCalledWith({
    environmentId: "test-env",
    input: { slug: "acme", name: "Acme", allowedDomains: ["acme.test"] },
  });
});

it.each(["confirm", "cancel", "no dialog"] as const)(
  "requires explicit consent before joining an offered workspace: %s",
  async (decision) => {
    using _setup = setup();
    await using screen = await render(null);
    mocks.peerHubStatus = {
      ...SIGNED_OUT,
      signedIn: true,
      email: "ana@acme.test",
      domainOffers: [
        {
          slug: "another",
          name: "Another Acme",
          domain: "acme.test",
          holder: { slug: "acme", name: "Acme", verified: true },
        },
      ],
    };
    mocks.confirm.mockResolvedValue(decision === "confirm");
    mocks.dialogAvailable = decision !== "no dialog";
    await openTeamStep(screen);
    expect(document.body.textContent).toContain("Acme holds it");
    expect(document.body.textContent).not.toContain("Create the Acme workspace");
    await click("Review");
    if (decision === "confirm") {
      expect(mocks.join).toHaveBeenCalledWith({
        environmentId: "test-env",
        input: { workspace: "another", confirmDomainMatch: true },
      });
    } else {
      expect(mocks.join).not.toHaveBeenCalled();
      if (decision === "no dialog")
        expect(document.body.textContent).toContain("No dialog host is available.");
    }
  },
);
