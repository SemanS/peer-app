import { assert, describe, it } from "@effect/vitest";

import {
  herdrIntegrationDir,
  herdrIntegrationFiles,
  herdrIntegrationStatuses,
  parseHerdrIntegrationStatus,
  setHerdrIntegration,
  type HerdrIntegrationHost,
} from "./integration.ts";
import type { HerdrCommandResult, HerdrCommandRunner } from "./server.ts";

/**
 * What herdr 0.9.3 printed, recorded by running the pinned macOS binary with a fresh HOME, XDG
 * directories and no server. `herdr integration status` lists every integration it knows, one
 * line each, ending with the hook file; the others are shortened here.
 */
const STATUS_OUTPUT = {
  none: `pi: not installed (/home/ana/.pi/agent/extensions/herdr-agent-state.ts)
claude: not installed (/home/ana/.claude/hooks/herdr-agent-state.sh)
codex: not installed (/home/ana/.codex/herdr-agent-state.sh)
copilot: not installed (/home/ana/.copilot/hooks/herdr-agent-state.sh)
letta (experimental): not installed (/home/ana/.letta/hooks/herdr-agent-session.sh)
`,
  current: `claude: current (v10) (/home/ana/.claude/hooks/herdr-agent-state.sh)
codex: current (v8) (/home/ana/.codex/herdr-agent-state.sh)
`,
  outdated: `claude: outdated (v3 < v10) (/home/ana/.claude/hooks/herdr-agent-state.sh)
codex: current (v8) (/home/ana/.codex/herdr-agent-state.sh)
`,
};
const INSTALL_OUTPUT = {
  claude: `installed claude integration hook to /home/ana/.claude/hooks/herdr-agent-state.sh
ensured claude settings at /home/ana/.claude/settings.json
`,
  codex: `installed codex integration hook to /home/ana/.codex/herdr-agent-state.sh
ensured codex hooks at /home/ana/.codex/hooks.json
ensured codex config at /home/ana/.codex/config.toml
`,
  claudeWithoutFolder:
    "claude directory not found at /home/ana/.claude. install claude code first\n",
};
const UNINSTALL_OUTPUT = `removed codex hook at /home/ana/.codex/herdr-agent-state.sh
removed herdr codex hook entries from /home/ana/.codex/hooks.json
left codex config unchanged at /home/ana/.codex/config.toml
`;

const BIN = "/Applications/Peer.app/Contents/Resources/herdr/herdr";
const env = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/ana",
  HERDR_CONFIG_PATH: "/peer/herdr/config.toml",
};

const host = (options: {
  readonly python?: boolean;
  readonly directories?: ReadonlyArray<string>;
}): HerdrIntegrationHost => ({
  hasProgram: (program) => program !== "python3" || options.python !== false,
  directoryExists: (path) =>
    (options.directories ?? ["/home/ana/.claude", "/home/ana/.codex"]).includes(path),
});

/** A runner that answers the next command with `result` and records every command line. */
function recording(...results: ReadonlyArray<Partial<HerdrCommandResult>>) {
  const commands: Array<{ line: ReadonlyArray<string>; env: Readonly<Record<string, string>> }> =
    [];
  const run: HerdrCommandRunner = async (file, args, options) => {
    commands.push({ line: [file, ...args], env: options.env });
    return {
      code: 0,
      stdout: "",
      stderr: "",
      ...results[Math.min(commands.length, results.length) - 1],
    };
  };
  return { run, commands };
}

describe("parseHerdrIntegrationStatus", () => {
  it("reads herdr's lines for Claude Code and Codex and skips the rest", () => {
    assert.deepStrictEqual(
      [...parseHerdrIntegrationStatus(STATUS_OUTPUT.none)],
      [
        ["claude", "missing"],
        ["codex", "missing"],
      ],
    );
    assert.deepStrictEqual(
      [...parseHerdrIntegrationStatus(STATUS_OUTPUT.current)],
      [
        ["claude", "installed"],
        ["codex", "installed"],
      ],
    );
    assert.deepStrictEqual(
      [...parseHerdrIntegrationStatus(STATUS_OUTPUT.outdated)],
      [
        ["claude", "outdated"],
        ["codex", "installed"],
      ],
    );
  });

  it("skips lines in a shape it does not know", () => {
    assert.strictEqual(parseHerdrIntegrationStatus("claude: broken somehow\nunrelated\n").size, 0);
    assert.strictEqual(parseHerdrIntegrationStatus("").size, 0);
  });
});

describe("where the integrations write", () => {
  it("honors CLAUDE_CONFIG_DIR and CODEX_HOME, else the home folder's", () => {
    assert.strictEqual(herdrIntegrationDir("claude", env), "/home/ana/.claude");
    assert.strictEqual(herdrIntegrationDir("codex", env), "/home/ana/.codex");
    assert.strictEqual(
      herdrIntegrationDir("claude", { ...env, CLAUDE_CONFIG_DIR: "/work/claude" }),
      "/work/claude",
    );
    assert.strictEqual(
      herdrIntegrationDir("codex", { ...env, CODEX_HOME: "/work/codex" }),
      "/work/codex",
    );
  });

  it("lists the files each integration changes", () => {
    assert.deepStrictEqual(herdrIntegrationFiles("claude", env), [
      "/home/ana/.claude/settings.json",
      "/home/ana/.claude/hooks/herdr-agent-state.sh",
    ]);
    assert.deepStrictEqual(herdrIntegrationFiles("codex", { ...env, CODEX_HOME: "/work/codex" }), [
      "/work/codex/hooks.json",
      "/work/codex/config.toml",
      "/work/codex/herdr-agent-state.sh",
    ]);
  });
});

describe("herdrIntegrationStatuses", () => {
  it("asks herdr once, with the cleaned environment, and reports installed", async () => {
    const { run, commands } = recording({ stdout: STATUS_OUTPUT.current });
    const statuses = await herdrIntegrationStatuses({ bin: BIN, env, run, host: host({}) });
    assert.deepStrictEqual(commands, [{ line: [BIN, "integration", "status"], env }]);
    assert.deepStrictEqual(
      statuses.map(({ agent, state }) => [agent, state]),
      [
        ["claude", "installed"],
        ["codex", "installed"],
      ],
    );
    assert.deepStrictEqual(statuses[0]?.files, herdrIntegrationFiles("claude", env));
    assert.notProperty(statuses[0] ?? {}, "reason");
  });

  it("reports outdated and missing", async () => {
    const outdated = await herdrIntegrationStatuses({
      bin: BIN,
      env,
      run: recording({ stdout: STATUS_OUTPUT.outdated }).run,
      host: host({}),
    });
    assert.deepStrictEqual(
      outdated.map((entry) => entry.state),
      ["outdated", "installed"],
    );
    const missing = await herdrIntegrationStatuses({
      bin: BIN,
      env,
      run: recording({ stdout: STATUS_OUTPUT.none }).run,
      host: host({}),
    });
    assert.deepStrictEqual(
      missing.map((entry) => entry.state),
      ["missing", "missing"],
    );
  });

  it("is unavailable, saying why, without python3", async () => {
    const statuses = await herdrIntegrationStatuses({
      bin: BIN,
      env,
      run: recording({ stdout: STATUS_OUTPUT.none }).run,
      host: host({ python: false }),
    });
    for (const status of statuses) {
      assert.strictEqual(status.state, "unavailable");
      assert.match(status.reason ?? "", /python3 was not found/);
    }
  });

  it("is unavailable, saying why, when the agent's folder does not exist", async () => {
    const statuses = await herdrIntegrationStatuses({
      bin: BIN,
      env,
      run: recording({ stdout: STATUS_OUTPUT.none }).run,
      host: host({ directories: ["/home/ana/.codex"] }),
    });
    assert.strictEqual(statuses[0]?.state, "unavailable");
    assert.match(
      statuses[0]?.reason ?? "",
      /Claude Code's configuration folder \(\/home\/ana\/\.claude\) does not exist/,
    );
    assert.strictEqual(statuses[1]?.state, "missing");
  });

  it("still shows what is installed when it can no longer run, so it can be removed", async () => {
    const statuses = await herdrIntegrationStatuses({
      bin: BIN,
      env,
      run: recording({ stdout: STATUS_OUTPUT.current }).run,
      host: host({ python: false }),
    });
    assert.strictEqual(statuses[0]?.state, "installed");
    assert.match(statuses[0]?.reason ?? "", /python3/);
  });

  it("is unavailable when herdr fails or answers in a shape it does not know", async () => {
    for (const result of [
      { code: 1, stderr: "boom" },
      { code: null },
      { stdout: "nothing useful" },
    ]) {
      const statuses = await herdrIntegrationStatuses({
        bin: BIN,
        env,
        run: recording(result).run,
        host: host({}),
      });
      assert.deepStrictEqual(
        statuses.map((entry) => entry.state),
        ["unavailable", "unavailable"],
      );
      assert.match(statuses[0]?.reason ?? "", /could not report its Claude Code integration/);
    }
  });
});

describe("setHerdrIntegration", () => {
  it("installs through herdr's installer with the cleaned environment", async () => {
    const { run, commands } = recording({ stdout: INSTALL_OUTPUT.claude });
    const done = await setHerdrIntegration("claude", true, { bin: BIN, env, run, host: host({}) });
    assert.deepStrictEqual(commands, [{ line: [BIN, "integration", "install", "claude"], env }]);
    assert.deepStrictEqual(done, {
      ok: true,
      messages: [
        "installed claude integration hook to /home/ana/.claude/hooks/herdr-agent-state.sh",
        "ensured claude settings at /home/ana/.claude/settings.json",
      ],
    });
  });

  it("installs Codex and removes with `uninstall`", async () => {
    const install = recording({ stdout: INSTALL_OUTPUT.codex });
    await setHerdrIntegration("codex", true, { bin: BIN, env, run: install.run, host: host({}) });
    assert.deepStrictEqual(install.commands[0]?.line, [BIN, "integration", "install", "codex"]);
    const remove = recording({ stdout: UNINSTALL_OUTPUT });
    const done = await setHerdrIntegration("codex", false, {
      bin: BIN,
      env,
      run: remove.run,
      host: host({}),
    });
    assert.deepStrictEqual(remove.commands[0]?.line, [BIN, "integration", "uninstall", "codex"]);
    assert.strictEqual(done.ok, true);
    assert.strictEqual(done.ok ? done.messages.length : 0, 3);
  });

  it("refuses to install where the integration cannot work, without running herdr", async () => {
    const noPython = recording();
    const refusedForPython = await setHerdrIntegration("claude", true, {
      bin: BIN,
      env,
      run: noPython.run,
      host: host({ python: false }),
    });
    assert.strictEqual(refusedForPython.ok, false);
    assert.match(refusedForPython.ok ? "" : refusedForPython.reason, /python3/);
    const noFolder = recording();
    const refusedForFolder = await setHerdrIntegration("claude", true, {
      bin: BIN,
      env,
      run: noFolder.run,
      host: host({ directories: [] }),
    });
    assert.strictEqual(refusedForFolder.ok, false);
    assert.deepStrictEqual([noPython.commands, noFolder.commands], [[], []]);
  });

  it("removes even where it could not be installed", async () => {
    const { run, commands } = recording({ stdout: UNINSTALL_OUTPUT });
    const done = await setHerdrIntegration("codex", false, {
      bin: BIN,
      env,
      run,
      host: host({ python: false, directories: [] }),
    });
    assert.strictEqual(done.ok, true);
    assert.strictEqual(commands.length, 1);
  });

  it("passes on herdr's own words when it fails", async () => {
    const failed = await setHerdrIntegration("claude", true, {
      bin: BIN,
      env,
      run: recording({ code: 1, stderr: INSTALL_OUTPUT.claudeWithoutFolder }).run,
      host: host({}),
    });
    assert.deepStrictEqual(failed, {
      ok: false,
      reason: "claude directory not found at /home/ana/.claude. install claude code first",
    });
    const silent = await setHerdrIntegration("codex", false, {
      bin: BIN,
      env,
      run: recording({ code: null }).run,
      host: host({}),
    });
    assert.deepStrictEqual(silent, {
      ok: false,
      reason: "herdr could not uninstall its Codex integration.",
    });
  });
});
