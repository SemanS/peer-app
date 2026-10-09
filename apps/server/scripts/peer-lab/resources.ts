/** Opt-in real lab only; each agent calls the broker's generated shim, never a person's install. */
interface Agent {
  readonly name: string;
  readonly peer: (...args: string[]) => string;
  readonly peerAsync: (...args: string[]) => Promise<string>;
  readonly hook: (event: string, extra?: Record<string, unknown>) => unknown;
  readonly prepare: (
    event: string,
    extra?: Record<string, unknown>,
  ) => { go: () => Promise<unknown> };
  readonly file: (path: string) => string;
  readonly start: () => unknown;
}
export async function resourceLab(input: {
  readonly agents: readonly [Agent, Agent];
  readonly configurePatterns: () => Promise<void>;
  readonly check: (okay: boolean, description: string) => void;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly say: (label: string, text: string) => void;
}) {
  const { agents, check, pause, say } = input;
  for (const a of agents) a.start();
  const answers = await Promise.all(
    agents.map((a) => a.peerAsync("claim", "resource:deploy-staging", "--ttl", "1m")),
  );
  check(
    answers.filter((a) => a.startsWith("Held resource:")).length === 1,
    "resource race has exactly one holder",
  );
  check(
    answers.filter((a) => a.startsWith("peer: refused:")).length === 1,
    "other resource claimant hears a refusal",
  );
  const winner = answers[0]?.startsWith("Held resource:") ? 0 : 1;
  const holder = agents[winner],
    waiting = agents[1 - winner]!;
  say("leased scope race", answers.join("\n"));
  check(
    holder.peer("release", "resource:deploy-staging").includes("Released resource:"),
    "holder releases the resource",
  );
  await pause(1000);
  const free = JSON.stringify(waiting.hook("UserPromptSubmit", { prompt: "check coordination" }));
  check(free.includes("free now"), "waiting agent hears the one-time free notice");
  check(
    !JSON.stringify(waiting.hook("UserPromptSubmit", { prompt: "check again" })).includes(
      "free now",
    ),
    "free notice is not repeated",
  );
  check(
    waiting.peer("claim", "resource:deploy-staging", "--ttl", "1m").startsWith("Held resource:"),
    "free resource can be claimed again",
  );
  const lapsing = JSON.stringify(waiting.hook("UserPromptSubmit", { prompt: "check lease" }));
  check(lapsing.includes("expires in 1 min"), "short lease produces the one-time lapsing notice");
  say(
    "lease expiry",
    "Waiting for the isolated 60 second lease to expire; both agents still report.",
  );
  for (let n = 0; n < 5; n++) await pause(13_000);
  const lost = JSON.stringify(waiting.hook("UserPromptSubmit", { prompt: "check expired lease" }));
  check(lost.includes("no longer held"), "expired hold is lost although the session still reports");
  check(
    !JSON.stringify(waiting.hook("UserPromptSubmit", { prompt: "check again" })).includes(
      "no longer held",
    ),
    "lost notice is not repeated",
  );
  await input.configurePatterns();
  const edits = agents.map((a, i) =>
    a.prepare("PreToolUse", {
      tool_name: "Edit",
      tool_input: {
        file_path: a.file(`migrations/0019_${i}.sql`),
        old_string: "a",
        new_string: "b",
      },
    }),
  );
  const verdicts = await Promise.all(edits.map((e) => e.go()));
  const denied = verdicts.map((v) => JSON.stringify(v).includes('"permissionDecision":"deny"'));
  check(denied.filter(Boolean).length === 1, "two files in one exclusive pattern have one holder");
  const patternHolder = agents[denied[0] ? 1 : 0];
  check(
    patternHolder.peer("status").includes("pattern:migrations/**"),
    "status names the leased pattern",
  );
  check(
    patternHolder.peer("release", "migrations/**").includes("Released migrations/**"),
    "an exact quoted pattern releases its lease",
  );
  for (const a of agents) a.hook("SessionEnd", { reason: "exit" });
}
