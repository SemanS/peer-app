/** Host-side dependency fixture ports; only the lab owns their Hub and generated shims. */
type HubCall = (
  path: string,
  input: { method?: string; body?: unknown },
) => Promise<Record<string, unknown>>;
export async function withDependencyEvidence(
  hub: HubCall,
  run: (evidence: {
    report: (task: string, state: "open" | "merged") => Promise<void>;
    followup: (task: string) => Promise<void>;
    clear: () => Promise<void>;
  }) => Promise<void>,
) {
  const base = "/v1/workspaces/acme",
    repository = { id: "lab-pr-evidence", url: "https://github.com/acme/lab.git", branch: "main" };
  const record = (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("missing dependency fixture config");
    return value as Record<string, unknown>;
  };
  const config = async () => {
    const current = record((await hub(`${base}/config`, {})).config),
      projects = record(current.projects),
      project = record(projects.lab);
    if (!Array.isArray(project.repositories))
      throw new Error("missing dependency fixture repositories");
    return { current, projects, project, repositories: project.repositories as unknown[] };
  };
  const apply = async (value: Awaited<ReturnType<typeof config>>, repositories: unknown[]) => {
    await hub(`${base}/config`, {
      method: "PUT",
      body: {
        config: {
          ...value.current,
          projects: { ...value.projects, lab: { ...value.project, repositories } },
        },
      },
    });
  };
  const before = await config();
  if (before.repositories.some((repo) => record(repo).id === repository.id))
    throw new Error("dependency evidence repository already exists");
  // This repository is metadata for public work-report validation, never an opened checkout.
  // The original local bare origin remains unchanged; no GitHub integration is configured.
  const clear = async () => {
    await hub(`${base}/threads`, {
      method: "PUT",
      body: { environment: "dependency-evidence", threads: [] },
    });
  };
  try {
    await apply(before, [...before.repositories, repository]);
    await run({
      clear,
      followup: async (task) => {
        // A cleared runtime retains its merged PR. Reopening adds new unfinished work rather
        // than rewriting the historical delivery or pretending a closed runtime erased it.
        const accepted = await hub(`${base}/threads`, {
          method: "PUT",
          body: {
            environment: "dependency-evidence",
            threads: [
              {
                id: "peer:dependency-followup",
                project: "lab",
                task,
                repository: repository.id,
                title: "unfinished follow-up",
                status: "working",
                branch: "vl1-dependency-followup",
                pullRequests: [],
              },
            ],
          },
        });
        if (accepted.accepted !== 1) throw new Error("dependency follow-up work was not accepted");
      },
      report: async (task, state) => {
        const accepted = await hub(`${base}/threads`, {
          method: "PUT",
          body: {
            environment: "dependency-evidence",
            threads: [
              {
                id: "peer:dependency-evidence",
                project: "lab",
                task,
                repository: repository.id,
                title: "delivery evidence",
                status: "done",
                branch: "vl1-dependency-prerequisite",
                pullRequests: [
                  {
                    url: "https://github.com/acme/lab/pull/18",
                    state,
                    headBranch: "vl1-dependency-prerequisite",
                  },
                ],
              },
            ],
          },
        });
        if (accepted.accepted !== 1) throw new Error("dependency PR work was not accepted");
      },
    });
  } finally {
    try {
      await clear();
    } finally {
      const latest = await config();
      await apply(
        latest,
        latest.repositories.filter((repo) => record(repo).id !== repository.id),
      );
    }
  }
}
export async function observeDependencyIdle(input: {
  session: string;
  wait: Promise<string | null>;
  events: () => ReadonlyArray<{ event: string; session?: unknown }>;
  pause: (milliseconds: number) => Promise<void>;
}) {
  let ended = false;
  void input.wait.then(
    () => {
      ended = true;
    },
    () => {
      ended = true;
    },
  );
  const check = async () => {
    await Promise.resolve();
    if (ended) throw new Error("dependency observer wait ended");
    if (input.events().some((row) => row.session === input.session && row.event === "wake"))
      throw new Error("dependency observer was woken");
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    await check();
    if (input.events().some((row) => row.session === input.session && row.event === "wait"))
      return { check };
    await input.pause(100);
  }
  throw new Error("dependency observer did not enter a wait");
}
