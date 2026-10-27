// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - temporary editor settings files.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { mcpClient } from "./clients.ts";
import { changeFile, listClients, userBases } from "./connect.ts";

const server = { command: "/state/coord/bin/peer", args: ["mcp"] };
let home: string;

beforeEach(async () => {
  home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-mcp-clients-"));
});
afterEach(async () => {
  await NodeFSP.rm(home, { recursive: true, force: true });
});

const read = async (path: string) => JSON.parse(await NodeFSP.readFile(path, "utf8"));

describe("connecting editors", () => {
  it("merges only the peer entry and removes only it, idempotently", async () => {
    const cursor = mcpClient("cursor")!;
    const path = NodePath.join(home, ".cursor", "mcp.json");
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
    await NodeFSP.writeFile(
      path,
      JSON.stringify({ theme: "dark", mcpServers: { db: { command: "pg" } } }),
    );

    expect((await changeFile("connect", cursor, cursor.user!, path, server)).outcome).toBe(
      "written",
    );
    expect(await read(path)).toEqual({
      theme: "dark",
      mcpServers: { db: { command: "pg" }, peer: { command: server.command, args: ["mcp"] } },
    });
    expect((await changeFile("connect", cursor, cursor.user!, path, server)).outcome).toBe(
      "unchanged",
    );

    expect((await changeFile("disconnect", cursor, cursor.user!, path, server)).outcome).toBe(
      "written",
    );
    expect(await read(path)).toEqual({ theme: "dark", mcpServers: { db: { command: "pg" } } });
    expect((await changeFile("disconnect", cursor, cursor.user!, path, server)).outcome).toBe(
      "unchanged",
    );
  });

  it("writes each client's own entry shape", async () => {
    const opencode = mcpClient("opencode")!;
    const path = NodePath.join(home, "opencode.json");
    await changeFile("connect", opencode, opencode.project!, path, server);
    expect((await read(path)).mcp.peer).toEqual({
      type: "local",
      command: [server.command, "mcp"],
      enabled: true,
    });
  });

  it("leaves a file with comments alone and gives the entry to paste", async () => {
    const zed = mcpClient("zed")!;
    const path = NodePath.join(home, "settings.json");
    const jsonc = '// my settings\n{ "vim_mode": true }\n';
    await NodeFSP.writeFile(path, jsonc);

    const answer = await changeFile("connect", zed, zed.user!, path, server);

    expect(answer.outcome).toBe("manual");
    expect(JSON.parse(answer.entry)).toEqual({
      context_servers: { peer: { source: "custom", command: server.command, args: ["mcp"] } },
    });
    expect(await NodeFSP.readFile(path, "utf8")).toBe(jsonc);
  });

  it("lists what is installed and connected", async () => {
    const bases = userBases(home, "linux", {});
    await NodeFSP.mkdir(NodePath.join(home, ".gemini"), { recursive: true });
    const gemini = mcpClient("gemini")!;
    await changeFile(
      "connect",
      gemini,
      gemini.user!,
      NodePath.join(home, ".gemini", "settings.json"),
      server,
    );

    const clients = await listClients(bases);

    expect(clients.find((c) => c.id === "gemini")).toMatchObject({
      installed: true,
      user: { connected: true },
    });
    expect(clients.find((c) => c.id === "cursor")).toMatchObject({
      installed: false,
      user: { connected: false },
    });
    expect(clients.every((c) => c.project === undefined)).toBe(true);
  });
});
