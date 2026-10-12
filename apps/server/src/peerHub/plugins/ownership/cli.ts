// @effect-diagnostics nodeBuiltinImport:off - a path an agent types is read against its checkout.
/**
 * `peer owner`: who owns the session's task and the paths it changed, and the calls it made;
 * `peer owner ask <path>... "<why>"` asks the owner of paths where the owner decides, one call per
 * owner; `peer owner withdraw <id>` takes one back. Without a session (a person's terminal in a
 * workspace checkout) `peer owner` prints the project's owner map and records nothing. The commands
 * follow the peer-cli-contract: what the Hub did not apply is refused, what may or may not have
 * happened is uncertain, and a wrong command line is a usage error.
 *
 * @module peerHub/plugins/ownership/cli
 */
import * as NodePath from "node:path";

import type { PeerOwnerCall, PeerOwnershipProject } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import {
  hubFailure,
  refused,
  usage,
  type PeerCommand,
  type PeerSessionView,
} from "../../core/plugin.ts";
import type * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { plain } from "../../peerText.ts";
import { callFailure } from "./client/failures.ts";
import {
  about,
  covers,
  effectiveOwner,
  generated,
  names,
  needsNoCall,
  ownerDecides,
  pathOwner,
  taskRow,
  waiting,
} from "./client/rules.ts";
import type { Directory, Ownership } from "./Ownership.ts";
import { ageText, pathsText, poss } from "./text.ts";

const ASK =
  'peer owner ask <path>... "<why>" (every path must be owner-decides and owned by someone else; at most 20 paths, why up to 300 characters)';
const WITHDRAW = "peer owner withdraw <id>";
const RETRY = "retry peer owner when the Hub is reachable.";

const bad = (reason: string, next: string) => Effect.fail(usage(reason, next));
const no = (reason: string, next: string) => Effect.fail(refused(reason, next));

/** A path as the Hub reads one: inside the repository, relative to it, a directory keeping its slash. */
function inRepository(session: PeerSessionView, cwd: string | undefined, raw: string) {
  const base = cwd?.startsWith(`${session.root}/`) === true ? cwd : session.root;
  const relative = NodePath.relative(session.root, NodePath.resolve(base, raw));
  return relative === "" || relative.startsWith("..")
    ? undefined
    : `${relative}${raw.endsWith("/") ? "/" : ""}`;
}

/** What `peer owner` prints to an agent: its task's owner, the owners of what it changed, its calls. */
function agentView(input: {
  readonly session: PeerSessionView;
  readonly project: PeerOwnershipProject;
  readonly person: string;
  readonly environment: string;
  readonly directory: Directory;
  readonly now: number;
}): string {
  const { session, project, person, directory: dir, now } = input;
  const { map } = project;
  const me = { id: session.id, email: person, environment: input.environment, task: session.task };
  const name = (email: string) => `${dir.name(email)}${email === person ? " (you)" : ""}`;
  const out: string[] = [];
  const task = dir.task(session.task);
  if (session.task !== undefined) {
    const row = taskRow(project, session.task);
    const owner = effectiveOwner(task ?? {}, row, map, dir.people);
    const by = dir.name(row?.by ?? "");
    const how =
      { request: "by request", handover: `handed over by ${by}`, named: `named by ${by}` }[
        row?.reason ?? ""
      ] ?? "by first agent";
    out.push(`${dir.label(session.task)}${task === undefined ? "" : ` ${plain(task.title, 80)}`}`);
    out.push(
      owner === undefined
        ? "  No owner"
        : `  Owner: ${name(owner.owner)}, ${owner.throughArea ? `through the area ${plain(task?.area ?? "", 60)}` : how}`,
    );
    const area = task?.area !== undefined && map.areas[task.area];
    if (task?.area !== undefined)
      out.push(
        `  Area: ${plain(task.area, 60)}, ${area ? `area owner ${name(area)}` : "no area owner"}`,
      );
  }
  const calls = project.calls.filter((call) => call.email === person && about(call, me));
  const files = session.files.filter((path) => !generated(path)).slice(0, 15);
  // A call that names a path shown here is said on its row; the others are listed after.
  const rest = new Set(calls);
  if (files.length > 0) {
    out.push("Paths your session changed:");
    const width = Math.min(60, Math.max(...files.map((path) => path.length))) + 3;
    for (const path of files) {
      const found = pathOwner(map, path);
      const call = calls.find((candidate) => names(candidate, path));
      if (call !== undefined) rest.delete(call);
      const parts = [
        found === undefined ? "no owner" : name(found.owner),
        ...(found !== undefined && ownerDecides(map, path) ? ["owner decides"] : []),
        ...(call === undefined ? [] : [`call ${call.id} ${call.state}`]),
      ];
      out.push(`  ${plain(path, 120).padEnd(width)}${parts.join(" · ")}`);
    }
  }
  if (rest.size > 0) {
    out.push("Your calls:");
    for (const call of [...rest].slice(0, 5)) {
      const state = waiting(call, now)
        ? `pending, ${ageText(now - Date.parse(call.createdAt))}`
        : call.state;
      out.push(`  ${call.id}  to ${dir.name(call.owner)}  ${state}  ${pathsText(call.paths)}`);
    }
  }
  const decides = map.decide.map(
    (glob) => `${plain(glob, 60)} (${dir.name(pathOwner(map, glob)?.owner ?? "nobody")})`,
  );
  out.push(`Owner-decides patterns here: ${decides.length === 0 ? "none" : decides.join(", ")}`);
  return out.join("\n");
}

/** What `peer owner` prints to a person's terminal: the project's owner map, read-only. */
function mapView({ map }: PeerOwnershipProject, dir: Directory): string {
  const rows = (label: string, lines: ReadonlyArray<string>) =>
    lines.length === 0
      ? [`${label}  none`]
      : lines.map((line, at) => `${at === 0 ? `${label}  ` : "        "}${line}`);
  const globs = [...Object.keys(map.paths), ...map.decide.filter((glob) => !(glob in map.paths))];
  const width = Math.max(0, ...globs.map((glob) => glob.length)) + 2;
  return [
    `${dir.projectName} · owner map v${map.version}`,
    ...rows(
      "Areas:",
      Object.entries(map.areas).map(([area, owner]) => `${plain(area, 60)}  ${dir.name(owner)}`),
    ),
    ...rows(
      "Paths:",
      globs.map(
        (glob) =>
          `${plain(glob, 120).padEnd(width)}${dir.name(map.paths[glob] ?? "nobody")}${map.decide.includes(glob) ? "  owner decides" : ""}`,
      ),
    ),
    "Nothing was recorded.",
  ].join("\n");
}

/** What an ask came to: one clause per call, then what the agent waits for. */
function askedView(
  calls: ReadonlyArray<PeerOwnerCall>,
  merged: ReadonlyArray<string>,
  dir: Directory,
) {
  const said = calls.map((call) =>
    merged.includes(call.id)
      ? `Your call ${call.id} to ${dir.name(call.owner)} already waits and names ${pathsText(call.paths)}`
      : `Asked ${dir.name(call.owner)} (call ${call.id}${call.task === undefined ? "" : `, ${dir.label(call.task)}`})`,
  );
  const owners = [...new Set(calls.map((call) => dir.name(call.owner)))];
  const wait =
    owners.length === 1
      ? `${poss(owners[0]!)} call; it is in ${poss(owners[0]!)} Needs you`
      : "their calls; each is in its owner’s Needs you";
  return `${said.join(". ")}. Your edits of ${pathsText(calls.flatMap((call) => call.paths))} wait for ${wait}, and you will hear the answer.`;
}

/** `peer owner`, through the service, logging what became of a call through coordination. */
export const ownerCommand = (
  owned: Ownership["Service"],
  agents: PeerAgents.PeerAgents["Service"],
): PeerCommand => ({
  name: "owner",
  usage: `owner | owner ask <path>... "<why>" | owner withdraw <id>`,
  summary:
    "who owns your task and paths; ask the owner of a path where they decide; take a call back",
  waitSeconds: 30,
  public: true,
  run: ({ session, args, plain: words, cwd }) =>
    Effect.gen(function* () {
      const [verb, ...rest] = words;
      if (
        args.some((arg) => arg.startsWith("--")) ||
        (verb !== undefined && verb !== "ask" && verb !== "withdraw")
      )
        return yield* bad(
          "peer owner takes no flags, and ask and withdraw are its only words",
          `peer owner | ${ASK} | ${WITHDRAW}`,
        );
      if (session.public === true && verb !== undefined)
        return yield* no(
          "this call does not come from an agent session, so Peer cannot tell who is acting",
          "run peer from the shell of an agent session (Claude Code or Codex with Peer's hooks installed). A person uses the Peer app: Work, then the task.",
        );
      const directory = owned.directory(session.workspace, session.project);
      // Printing reads the Hub; asking and withdrawing go by what Peer last read, which the Hub checks.
      const cached = verb === undefined ? undefined : owned.standing(session);
      const project =
        cached?.project ??
        (yield* owned
          .read(session.workspace, session.project)
          .pipe(Effect.mapError((error) => hubFailure(error, "owner", RETRY, true))));
      if (session.public === true) return mapView(project, directory);
      const standing = cached ?? owned.standing(session);
      if (standing === undefined) return yield* no("Peer does not know who is signed in", RETRY);
      const { person, environment } = standing;
      const me = { id: session.id, email: person, environment, task: session.task };
      const log = (outcome: string) =>
        agents.log("ownership.call", { session: session.id, outcome });
      const failed = (what: "ask" | "withdraw") =>
        Effect.mapError((error: Parameters<typeof callFailure>[0]) =>
          callFailure(error, what, what === "ask" ? ASK : WITHDRAW),
        );
      if (verb === undefined)
        return agentView({
          session,
          project,
          person,
          environment,
          directory,
          now: yield* Clock.currentTimeMillis,
        });

      if (verb === "withdraw") {
        const typed = rest[0];
        if (typed === undefined || rest.length !== 1)
          return yield* bad("name the call to withdraw", WITHDRAW);
        const found = project.calls.filter(
          (call) => call.email === person && call.id.startsWith(typed),
        );
        if (found.length > 1)
          return yield* bad(`${plain(typed, 60)} names several calls`, WITHDRAW);
        const call = yield* owned.withdrawCall(session, found[0]?.id ?? typed).pipe(
          failed("withdraw"),
          Effect.tapError((error) => log(error.outcome === "uncertain" ? "uncertain" : "refused")),
        );
        yield* log("withdrawn");
        return `Withdrew call ${call.id}. It left ${poss(directory.name(call.owner))} Needs you.`;
      }

      const [reason, raw] = [(rest.at(-1) ?? "").trim(), rest.slice(0, -1)];
      if (raw.length === 0 || reason === "") return yield* bad("name the paths and say why", ASK);
      if (raw.length > 20 || [...reason].length > 300)
        return yield* bad("an ask names at most 20 paths, and why is up to 300 characters", ASK);
      const paths: string[] = [];
      for (const path of raw) {
        const inside = inRepository(session, cwd, path);
        if (inside === undefined)
          return yield* bad(`${plain(path, 120)} is not inside this repository`, ASK);
        const not = needsNoCall(project.map, person, inside);
        if (not !== undefined)
          return yield* bad(`no call is needed for ${plain(inside, 120)}: ${not}`, ASK);
        paths.push(inside);
      }
      const open = paths.filter((path) => !project.calls.some((call) => covers(call, me, path)));
      if (open.length === 0)
        return yield* no(
          `${pathsText(paths)} ${paths.length === 1 ? "is" : "are"} covered by an accepted call already`,
          "change it; peer owner shows the call.",
        );
      const answer = yield* owned.ask(session, open, reason).pipe(
        failed("ask"),
        Effect.tapError((error) => log(error.outcome === "uncertain" ? "uncertain" : "refused")),
      );
      yield* log(answer.merged.length === answer.calls.length ? "merged" : "asked");
      return askedView(answer.calls, answer.merged, directory);
    }),
});
