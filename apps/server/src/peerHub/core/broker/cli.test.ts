// @effect-diagnostics nodeBuiltinImport:off - the broker's socket and the shim it writes, in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PeerCommandError, type PeerCommand, type PeerCommandInput } from "../plugin.ts";
import { helpText } from "./help.ts";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

/**
 * `peer help` while no plugin is registered: core's commands, in the lines agents have always read.
 * Each plugin's line follows them while it is active.
 */
const HELP_WITHOUT_PLUGINS = [
  "peer — coordinate with the other agents on this project through Peer.",
  "  peer status                     who works on what in this project, and your overlaps",
  '  peer claim <path>... [--intent "<why>"]   files or directories/ you are about to change',
  "  peer release [<path>...]        drop claims",
  "  peer index [<page>]             who works on what in this project",
  "  peer run                        your run: its id, task, state and sessions; it outlives this session",
  "  peer log [--task <key>] [--path <path>] committed coordination history",
  `  peer task [show <task> | add "<title>" | set <task> | remove <task>]  list or change tasks for your person`,
  `  peer share [--workspace <slug>] [--name "<name>"]  share this project, now only on this computer, with your person's workspace`,
  "",
  "Outcomes: 0 done (stdout); 2 usage; 3 refused; 4 uncertain; 5 Peer not running (stderr).",
  "Failures start with peer: <outcome>: <reason>, followed by Next: <step>.",
  "A pipe such as | head hides the exit status; read the first line.",
].join("\n");

/** A plugin command that ships work, and what it was asked. */
const deployCommand = () => {
  const asked: Array<PeerCommandInput> = [];
  const command: PeerCommand = {
    name: "deploy",
    usage: "deploy <target> [--note <text>]",
    summary: "ship this work to a target",
    waitSeconds: 60,
    run: (input) => {
      asked.push(input);
      return input.plain[0] === "production"
        ? Effect.fail(new PeerCommandError({ status: 422, message: "peer: not to production." }))
        : Effect.succeed(`Shipped to ${input.plain[0]}.`);
    },
  };
  return { asked, command };
};

/** The plugins with the deploy command, refused as `refused` says while its plugin is inactive. */
const withDeploy = (
  command: PeerCommand,
  refused: { current: "off" | "hub" | "hub-unknown" | undefined },
): PeerBrokerPlugins => ({
  ...NO_PLUGINS,
  commands: [
    {
      plugin: "deploys",
      command,
      ...(refused.current === undefined ? {} : { refused: refused.current }),
    },
  ],
});

/** `POST /cli/<command>` on the broker's socket, as the `peer` shim sends it. */
const cli = (socket: string, command: string, session: string) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = NodeHttp.request(
      {
        socketPath: socket,
        path: `/cli/${command}`,
        method: "POST",
        headers: { "x-peer-session": session },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("error", reject);
        response.on("end", () => resolve({ status: response.statusCode!, text }));
      },
    );
    request.on("error", reject);
    request.end("staging\0");
  });

describe("the peer command", () => {
  it.each([
    ["clear", "clear"],
    ["notify", "notify"],
    // What an older Hub may still say: nothing stops an agent.
    ["deny", "notify"],
  ] as const)("claim says %s as %s", async (verdict, expected) => {
    const fixture = await brokerFixture(() => ({
      intent: async (_workspace, _project, input) => ({
        at: "2026-10-09T10:00:00Z",
        verdicts: input.paths.map((path) => ({
          path,
          verdict,
          with: verdict === "clear" ? [] : ["other"],
          overlaps: [],
        })),
        overlaps: [],
      }),
    }));
    try {
      await fixture.register("one");
      expect(
        await fixture.broker.runCli("claim", ["src/api.ts"], { "x-peer-session": "claude:one" }),
      ).toContain(`src/api.ts: ${expected}`);
    } finally {
      await fixture.dispose();
    }
  });
  it("a failed intent retains an explicitly unverified held path", async () => {
    const failed = await brokerFixture(() => ({
      intent: async () => {
        throw new Error("deadline");
      },
    }));
    try {
      await failed.register("one");
      const headers = { "x-peer-session": "claude:one" };
      expect(await failed.broker.runCli("claim", ["a.ts"], headers)).toContain(
        "a.ts: notify — The Hub could not be reached",
      );
      expect(await failed.broker.runCli("release", [], headers)).toContain(
        "a.ts: held until this session ends",
      );
    } finally {
      await failed.dispose();
    }
  });
  it("claims tell the hub and release names only Hub-held paths", async () => {
    const calls: string[][] = [];
    const fixture = await brokerFixture(() => ({
      intent: async (_workspace, _project, input) => {
        calls.push([...input.paths]);
        return {
          at: "2026-10-09T10:00:00.000Z",
          verdicts: input.paths.map((path) => ({ path, verdict: "clear", with: [], overlaps: [] })),
          overlaps: [],
        };
      },
    }));
    try {
      await fixture.register("one");
      const headers = { "x-peer-session": "claude:one" };
      expect(
        await fixture.broker.runCli("claim", ["src/pay.ts", "package-lock.json"], headers),
      ).toContain("src/pay.ts: clear");
      expect(calls).toEqual([["src/pay.ts"]]);
      expect(await fixture.broker.runCli("release", [], headers)).toContain(
        "src/pay.ts: held until this session ends",
      );
      expect(fixture.broker.sessions.get("claude:one")!.claims).toEqual([]);
      await expect(
        fixture.broker.runCli("claim", ["src/local.ts", "../../outside"], headers),
      ).rejects.toMatchObject({ outcome: "usage" });
      expect(calls).toHaveLength(1);
      expect(fixture.broker.sessions.get("claude:one")!.claims).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });
  it("runs an explicit public plugin read without attributing a shell to an agent", async () => {
    const read = deployCommand();
    const current = { current: undefined as "off" | "hub" | undefined };
    const fixture = await brokerFixture((host) => ({
      plugins: async () => withDeploy({ ...read.command, public: true }, current),
      placeOf: async (cwd) => (cwd === "/outside" ? null : host.placeOf(cwd)),
    }));
    try {
      await fixture.register("one");
      expect(
        await fixture.broker.runCli("deploy", ["staging"], { "x-peer-cwd": fixture.root }),
      ).toBe("Shipped to staging.");
      expect(read.asked[0]?.session).toMatchObject({ public: true, id: "" });
      expect(fixture.broker.sessions.size).toBe(1);
      current.current = "off";
      await expect(
        fixture.broker.runCli("deploy", ["staging"], { "x-peer-cwd": fixture.root }),
      ).rejects.toMatchObject({ outcome: "refused" });
      expect(read.asked).toHaveLength(1);
      await expect(
        fixture.broker.runCli("deploy", ["staging"], { "x-peer-cwd": "/outside" }),
      ).rejects.toMatchObject({ outcome: "refused" });
    } finally {
      await fixture.dispose();
    }
  });
  it("runs a public plugin command for the verified session of a tool call", async () => {
    const read = deployCommand();
    const fixture = await brokerFixture(() => ({
      plugins: async () => withDeploy({ ...read.command, public: true }, { current: undefined }),
    }));
    try {
      const session = await fixture.broker.createSession(
        "claude",
        { session_id: "tool", cwd: fixture.root },
        undefined,
        "mcp",
        "peer:thread",
      );
      const reply = await fixture.broker.callTools(session!.id, "deploy", ["staging"], false);
      expect(reply.isError).toBe(false);
      expect(reply.text).toContain("Shipped to staging.");
      expect(read.asked[0]?.session).toMatchObject({ id: "claude:tool", adapter: "mcp" });
      expect(read.asked[0]?.session.public).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });
  it("prints core's commands while no plugin is registered", async () => {
    expect(helpText("peer", NO_PLUGINS)).toBe(HELP_WITHOUT_PLUGINS);
    const fixture = await brokerFixture();
    try {
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(HELP_WITHOUT_PLUGINS);
      // An unknown command still answers with help.
      await fixture.register("one");
      await expect(
        fixture.broker["runCli"]("telepathy", [], { "x-peer-session": "claude:one" }),
      ).rejects.toMatchObject({ outcome: "usage" });
    } finally {
      await fixture.dispose();
    }
  });

  it("lists and runs an active plugin's command, and refuses it in one line while inactive", async () => {
    const { asked, command } = deployCommand();
    const refused: { current: "off" | "hub" | "hub-unknown" | undefined } = { current: undefined };
    const fixture = await brokerFixture(() => ({
      plugins: async () => withDeploy(command, refused),
    }));
    try {
      await fixture.register("one");
      const headers = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(
        HELP_WITHOUT_PLUGINS.replace(
          "\n\nOutcomes:",
          "\n  peer deploy <target> [--note <text>]  ship this work to a target\n\nOutcomes:",
        ),
      );
      expect(
        await fixture.broker["runCli"]("deploy", ["staging", "--note", "first cut"], headers),
      ).toBe("Shipped to staging.");
      expect(asked[0]).toMatchObject({
        args: ["staging", "--note", "first cut"],
        plain: ["staging"],
        text: "staging",
        cwd: fixture.root,
        session: { id: "claude:one", agent: "claude", workspace: "acme", project: "app" },
      });
      expect(asked[0]?.flag("--note")).toBe("first cut");
      await expect(
        fixture.broker["runCli"]("deploy", ["production"], headers),
      ).rejects.toMatchObject({ status: 409, message: "not to production." });

      refused.current = "off";
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(HELP_WITHOUT_PLUGINS);
      await expect(fixture.broker["runCli"]("deploy", ["staging"], headers)).rejects.toMatchObject({
        status: 409,
        message: "deploy is turned off on this environment.",
      });
      refused.current = "hub-unknown";
      await expect(fixture.broker["runCli"]("deploy", ["staging"], headers)).rejects.toMatchObject({
        status: 409,
        message:
          "deploy waits for a Peer Hub: it works once Peer is signed in and its Hub answers.",
        next: "ask your person to sign Peer in to its Hub, or retry once the Hub can be reached.",
      });
      refused.current = "hub";
      await expect(fixture.broker["runCli"]("deploy", ["staging"], headers)).rejects.toMatchObject({
        status: 409,
        message: "deploy needs a newer Peer Hub.",
      });
      // Over the socket, as the shim sees it: one line and a failing status, and nothing ran.
      await fixture.broker.start();
      expect(await cli(NodePath.join(fixture.root, "peer.sock"), "deploy", "claude:one")).toEqual({
        status: 409,
        text: "peer: refused: deploy needs a newer Peer Hub.\nNext: ask your person to enable the plugin or update the Peer Hub, then retry.\n",
      });
      expect(asked).toHaveLength(2);
    } finally {
      await fixture.dispose();
    }
  });

  it("refuses a command that says why it cannot run here, and a command nobody has prints help", async () => {
    const { command } = deployCommand();
    const plugins: PeerBrokerPlugins = {
      ...NO_PLUGINS,
      commands: [
        {
          plugin: "observe",
          command,
          refused: "hub",
          unserved: "this command needs a shared Hub project",
        },
      ],
    };
    const fixture = await brokerFixture(() => ({ plugins: async () => plugins }));
    try {
      await fixture.register("one");
      const headers = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
      await expect(fixture.broker["runCli"](command.name, [], headers)).rejects.toMatchObject({
        status: 409,
        message: "this command needs a shared Hub project.",
      });
      await expect(fixture.broker["runCli"]("telepathy", [], headers)).rejects.toMatchObject({
        outcome: "usage",
      });
    } finally {
      await fixture.dispose();
    }
  });

  it("has the shim wait as long as any registered command asks, active or not", async () => {
    const { command } = deployCommand();
    const fixture = await brokerFixture(() => ({
      plugins: async () => withDeploy(command, { current: "off" }),
    }));
    try {
      await fixture.broker.start();
      const shim = await NodeFSP.readFile(
        NodePath.join(fixture.root, "scripts", "bin", "peer"),
        "utf8",
      );
      expect(shim).toContain("max=15\n[ \"$cmd\" = 'deploy' ] && max=60\n");
    } finally {
      await fixture.dispose();
    }
  });

  it("shows command help for a command's --help", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.register("help");
      const headers = { "x-peer-session": "claude:help" };
      for (const arg of ["--help", "-h"]) {
        expect(await fixture.broker["runCli"]("release", [arg], headers)).toContain("peer release");
      }
      expect(await fixture.broker["runCli"]("--help", [], {})).toContain("peer status");
    } finally {
      await fixture.dispose();
    }
  });
});
