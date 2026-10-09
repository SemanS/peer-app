// @effect-diagnostics nodeBuiltinImport:off globalDate:off - executes the generated CLI and hooks on private test sockets.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import { notRunning, render, uncertain } from "../broker/cliContract.ts";
import { coordinationScripts } from "./scripts.ts";

const run = (
  script: string,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = {},
  input = "",
) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = NodeChildProcess.spawn("sh", ["-c", script, "peer", ...args], {
      env: {
        ...process.env,
        PEER_SESSION: "",
        PEER_SESSION_TOKEN: "",
        CODEX_THREAD_ID: "",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });

async function stub() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-cli-test-"));
  const record = NodePath.join(root, "record");
  await NodeFSP.writeFile(
    NodePath.join(root, "curl"),
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' "$@" > "$RECORD.args"\nwhile [ $# -gt 0 ]; do\ncase "$1" in -H) case "$2" in @*) cp "\${2#@}" "$RECORD.headers"; stat -f '%Lp' "\${2#@}" > "$RECORD.mode";; esac; shift;; -o) body=$2; shift;; esac\nshift\ndone\nprintf '%s' "$BODY" > "$body"\nprintf '%s' "$HTTP"\necho 'curl diagnostics' >&2\nexit "$CODE"\n`,
    { mode: 0o755 },
  );
  const env = {
    PATH: `${root}:${process.env.PATH}`,
    RECORD: record,
    BODY: "",
    HTTP: "200",
    CODE: "0",
  };
  return {
    root,
    record,
    env,
    script: coordinationScripts("/absent", root, [["find", 150]]).peer,
    dispose: () => NodeFSP.rm(root, { recursive: true, force: true }),
  };
}

describe("the generated peer command contract", () => {
  it("maps every curl failure and preserves the exact first line, without diagnostics", async () => {
    const fixture = await stub();
    try {
      for (const code of [7, 127, 28, 52, 55, 56, 18, 23, 6, 2]) {
        const result = await run(fixture.script, ["note", "hello"], {
          ...fixture.env,
          CODE: String(code),
          PEER_CLI_TIMEOUT: "0.4",
        });
        const expected =
          code === 7 || code === 127
            ? notRunning()
            : render(
                uncertain(
                  "note",
                  code === 28
                    ? "Peer did not answer within 0.4 s"
                    : "the connection to Peer was lost",
                ),
              );
        expect(result).toEqual({
          code: code === 7 || code === 127 ? 5 : 4,
          stdout: "",
          stderr: `${expected}\n`,
        });
      }
      const request = await run(fixture.script, ["request", "bob", "hello"], {
        ...fixture.env,
        CODE: "28",
      });
      expect(request.stderr).toContain("its operation id makes a second send do nothing");
    } finally {
      await fixture.dispose();
    }
  });

  it("maps HTTP answers to their exit statuses and streams", async () => {
    const fixture = await stub();
    try {
      for (const [status, code] of [
        [200, 0],
        [204, 0],
        [400, 2],
        [409, 3],
        [500, 4],
      ] as const) {
        const body =
          status < 300
            ? "Done.\n"
            : "peer: refused: broker's exact text.\nNext: read the context.\n";
        const result = await run(fixture.script, ["note"], {
          ...fixture.env,
          HTTP: String(status),
          BODY: body,
        });
        expect(result).toEqual({
          code,
          stdout: code === 0 ? body : "",
          stderr: code === 0 ? "" : body,
        });
      }
      for (const status of [400, 409, 500, 404, 302]) {
        const result = await run(fixture.script, ["note"], {
          ...fixture.env,
          HTTP: String(status),
        });
        expect(result.stdout).toBe("");
        expect(result.code).not.toBe(1);
        expect(result.stderr).toMatch(/^peer: (usage|refused|uncertain): /);
        if (status === 404 || status === 302) expect(result.stderr).toContain(`HTTP ${status}`);
        const piped = await run(`(${fixture.script}) 2>&1 | head -1`, ["note"], {
          ...fixture.env,
          HTTP: String(status),
        });
        expect(piped.stdout.trim()).toBe(result.stderr.split("\n")[0]);
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps credentials private, strips header newlines, validates names and bounds deadlines", async () => {
    const fixture = await stub();
    try {
      for (const [command, timeout, expected] of [
        ["note", "", "15"],
        ["find", "", "150"],
        ["note", "0.4", "0.4"],
        ["note", "0", "15"],
        ["note", "abc", "15"],
        ["note", "1.2.3", "15"],
      ]) {
        const result = await run(fixture.script, [command!], {
          ...fixture.env,
          PEER_SESSION: "private-session\nInjected: value",
          PEER_SESSION_TOKEN: "private-token",
          HERDR_PANE_ID: "ignored-pane",
          PEER_CLI_TIMEOUT: timeout,
        });
        expect(result.code).toBe(0);
        const args = await NodeFSP.readFile(`${fixture.record}.args`, "utf8");
        expect(args).toContain(`--max-time\n${expected}\n`);
        expect(args).not.toContain("private-token");
        expect(args).not.toContain("private-session");
        const headers = await NodeFSP.readFile(`${fixture.record}.headers`, "utf8");
        expect(headers).toContain("X-Peer-Session: private-sessionInjected: value\n");
        expect(headers).toContain("X-Peer-Session-Token: private-token\n");
        expect(headers).not.toContain("Herdr");
        expect((await NodeFSP.readFile(`${fixture.record}.mode`, "utf8")).trim()).toBe("600");
      }
      await NodeFSP.rm(`${fixture.record}.args`);
      expect((await run(fixture.script, ["bad/name"], fixture.env)).code).toBe(2);
      await expect(NodeFSP.access(`${fixture.record}.args`)).rejects.toThrow();
      await run(fixture.script, ["status"], { ...fixture.env, CODEX_THREAD_ID: "codex-thread" });
      const headers = await NodeFSP.readFile(`${fixture.record}.headers`, "utf8");
      expect(headers).toContain("X-Peer-Session: codex-thread\n");
      expect(headers).not.toContain("Session-Token");
      const unavailableTemp = await run(fixture.script, ["note"], {
        ...fixture.env,
        TMPDIR: NodePath.join(fixture.root, "missing"),
      });
      expect(unavailableTemp.code).toBe(3);
      expect(unavailableTemp.stderr).toMatch(/^peer: refused:/);
    } finally {
      await fixture.dispose();
    }
  });

  it("reports a real timeout and an empty reply as uncertain, and a missing socket as not running", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-cli-real-"));
    const socket = NodePath.join(root, "peer.sock");
    const server = NodeHttp.createServer((request) => {
      request.resume();
    });
    try {
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      const script = coordinationScripts(socket, root).peer;
      const started = Date.now();
      const result = await run(script, ["note"], { PEER_CLI_TIMEOUT: "0.4" });
      expect(result.code).toBe(4);
      expect(result.stderr).toContain("within 0.4 s");
      expect(Date.now() - started).toBeLessThan(5000);
      server.removeAllListeners("request");
      server.on("request", (request) => request.socket.destroy());
      expect((await run(script, ["note"])).stderr).toContain("connection to Peer was lost");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      const script = coordinationScripts(socket, root).peer;
      expect((await run(script, ["note"])).code).toBe(5);
      await NodeFSP.writeFile(socket, "not a socket");
      expect((await run(script, ["note"])).code).toBe(5);
      await NodeFSP.rm(socket);
      const child = NodeChildProcess.spawn(process.execPath, [
        "-e",
        "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'))",
        socket,
      ]);
      try {
        await new Promise<void>((resolve, reject) => {
          child.stdout.once("data", () => resolve());
          child.once("error", reject);
        });
        const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGKILL");
        await ended;
        expect((await run(script, ["note"])).code).toBe(5);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("settings hooks mint nothing on Codex or non-start events and preserve a token even when Peer is absent", async () => {
    const fixture = await stub();
    try {
      const extra = `${fixture.record}.extra`;
      for (const command of ["od", "mktemp"])
        await NodeFSP.writeFile(
          NodePath.join(fixture.root, command),
          `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$RECORD.extra"\nexit 1\n`,
          { mode: 0o755 },
        );
      const script = coordinationScripts("/absent", fixture.root).hook;
      const envFile = NodePath.join(fixture.root, "environment.sh");
      await NodeFSP.writeFile(envFile, "");
      for (const [agent, event] of [
        ["codex", "SessionStart"],
        ["claude", "PreToolUse"],
      ]) {
        await run(
          script,
          [agent!],
          { ...fixture.env, CLAUDE_ENV_FILE: envFile, PEER_SESSION_TOKEN: "inherited" },
          JSON.stringify({ session_id: "one", hook_event_name: event, source: "startup" }),
        );
        await expect(NodeFSP.access(extra)).rejects.toThrow();
        expect(await NodeFSP.readFile(`${fixture.record}.args`, "utf8")).not.toContain("inherited");
      }
      const realScript = coordinationScripts("/absent", fixture.root).hook;
      const answer = await run(
        realScript,
        [],
        { CLAUDE_ENV_FILE: envFile, PEER_SESSION_TOKEN: "inherited" },
        JSON.stringify({ session_id: "one", hook_event_name: "SessionStart", source: "resume" }),
      );
      expect(answer).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(await NodeFSP.readFile(envFile, "utf8")).toMatch(
        /export PEER_SESSION_TOKEN=[0-9a-f]{32}/,
      );
      // The private header file is also used by settings hooks, not only by the CLI shim.
      await NodeFSP.rm(NodePath.join(fixture.root, "od"));
      await NodeFSP.rm(NodePath.join(fixture.root, "mktemp"));
      await run(
        script,
        [],
        { ...fixture.env, CLAUDE_ENV_FILE: envFile, TMPDIR: fixture.root },
        JSON.stringify({ session_id: "one", hook_event_name: "SessionStart", source: "startup" }),
      );
      expect((await NodeFSP.readFile(`${fixture.record}.mode`, "utf8")).trim()).toBe("600");
      expect(await NodeFSP.readFile(`${fixture.record}.headers`, "utf8")).toMatch(
        /^X-Peer-Session-Token: [0-9a-f]{32}/,
      );
    } finally {
      await fixture.dispose();
    }
  });

  it("settings SessionStart mints private tokens for new processes and keeps compaction unchanged", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-hook-"));
    const socket = NodePath.join(root, "peer.sock");
    const received: string[] = [];
    const server = NodeHttp.createServer((request, response) => {
      received.push(String(request.headers["x-peer-session-token"] ?? ""));
      request.resume();
      request.on("end", () => response.writeHead(204).end());
    });
    try {
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      const script = coordinationScripts(socket, root).hook;
      const tokens: string[] = [];
      for (const source of ["startup", "resume", "clear", "fork", "compact"]) {
        const envFile = NodePath.join(root, `${source}.sh`);
        await NodeFSP.writeFile(envFile, "");
        const result = await run(
          script,
          [],
          { CLAUDE_ENV_FILE: envFile, PEER_SESSION_TOKEN: "inherited", TMPDIR: root },
          JSON.stringify({ session_id: "session", hook_event_name: "SessionStart", source }),
        );
        expect(result.code).toBe(0);
        const token = /PEER_SESSION_TOKEN=([0-9a-f]{32})/.exec(
          await NodeFSP.readFile(envFile, "utf8"),
        )?.[1];
        if (source === "compact") {
          expect(token).toBeUndefined();
          expect(received.at(-1)).toBe("");
        } else {
          expect(token).toMatch(/^[0-9a-f]{32}$/);
          tokens.push(token!);
          expect(received.at(-1)).toBe(token);
        }
      }
      expect(new Set(tokens).size).toBe(4);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
