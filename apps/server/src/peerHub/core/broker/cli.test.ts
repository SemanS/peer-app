// @effect-diagnostics nodeBuiltinImport:off - the broker's socket and the shim it writes, in a temporary checkout.
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PeerCommandError, type PeerCommand, type PeerCommandInput } from "../plugin.ts";
import { helpText } from "./cli.ts";
import { NO_PLUGINS, type PeerBrokerPlugins } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

/**
 * `peer help` while no plugin is registered: core's commands, then those the broker still runs
 * itself, in the lines agents have always read. Each plugin's line follows them while it is active.
 */
const HELP_WITHOUT_PLUGINS = [
  "peer — coordinate with the other agents on this project through Peer.",
  "  peer status                     who works on what in this project, your overlaps and their notes",
  '  peer note "<text>"              a note to the agents you share files with (they hear it at their next step)',
  '  peer resolve "<agreement>"      close your open overlaps with what was agreed',
  '  peer claim <path>... [--intent "<why>"]   files or directories/ you are about to change',
  "  peer release [<path>...]        drop claims",
  "  peer index [<page>]             the project's work and its .ai, to choose what you need from",
  "  peer context [<task>] [history|<version>]  a work's shared context (yours by default), its versions, or one",
  "  peer ack <task>                 explicitly accept a changed shared context version",
  "  peer review                     hand your assigned task over for review after publishing context and checking inputs",
  "  peer done                       finish your assigned task only after all linked PRs have merged",
  "  peer log [--task <key>] [--path <path>] committed coordination history",
  "  peer knowledge [<id or words>]  the project's decisions, conventions, learnings and incidents: list, search or read one",
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
  refused: { current: "off" | "hub" | undefined },
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
  it("prints core's commands and the broker's own while no plugin is registered", async () => {
    expect(helpText("peer", NO_PLUGINS)).toBe(HELP_WITHOUT_PLUGINS);
    const fixture = await brokerFixture();
    try {
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(HELP_WITHOUT_PLUGINS);
      // An unknown command still answers with help.
      await fixture.register("one");
      expect(
        await fixture.broker["runCli"]("telepathy", [], { "x-peer-session": "claude:one" }),
      ).toBe(HELP_WITHOUT_PLUGINS);
    } finally {
      await fixture.dispose();
    }
  });

  it("lists and runs an active plugin's command, and refuses it in one line while inactive", async () => {
    const { asked, command } = deployCommand();
    const refused: { current: "off" | "hub" | undefined } = { current: undefined };
    const fixture = await brokerFixture(() => ({
      plugins: async () => withDeploy(command, refused),
    }));
    try {
      await fixture.register("one");
      const headers = { "x-peer-session": "claude:one", "x-peer-cwd": fixture.root };
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(
        `${HELP_WITHOUT_PLUGINS}\n  peer deploy <target> [--note <text>]  ship this work to a target`,
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
      ).rejects.toMatchObject({ status: 422, message: "peer: not to production." });

      refused.current = "off";
      expect(await fixture.broker["runCli"]("help", [], {})).toBe(HELP_WITHOUT_PLUGINS);
      await expect(fixture.broker["runCli"]("deploy", ["staging"], headers)).rejects.toMatchObject({
        status: 409,
        message: "peer: deploy is turned off on this environment.",
      });
      refused.current = "hub";
      await expect(fixture.broker["runCli"]("deploy", ["staging"], headers)).rejects.toMatchObject({
        status: 409,
        message: "peer: deploy needs a newer Peer Hub.",
      });
      // Over the socket, as the shim sees it: one line and a failing status, and nothing ran.
      await fixture.broker.start();
      expect(await cli(NodePath.join(fixture.root, "peer.sock"), "deploy", "claude:one")).toEqual({
        status: 409,
        text: "peer: deploy needs a newer Peer Hub.\n",
      });
      expect(asked).toHaveLength(2);
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
      expect(shim).toContain('max=15\n[ "$cmd" = deploy ] && max=60\n');
    } finally {
      await fixture.dispose();
    }
  });
});
