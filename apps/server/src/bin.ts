/**
 * Every ACP agent spawns `t3 acp-mcp-bridge` while opening its session, and terminal-fallback
 * agents run `t3 acp-mcp-call` per tool call, so their startup sits on first-message latency.
 * They and Codex's managed-token helper dispatch before the full CLI module graph (seconds
 * of evaluation) loads; everything else defers to the real CLI in ./binCli.ts.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { isEntrypoint } from "./entrypoint.ts";
import { enableCliCompileCache } from "./cliCompileCache.ts";

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  const npmPeerBin = /^peer(-core)?(\.(c|m)?js)?$/.test(NodePath.basename(process.argv[1] ?? ""));
  // The npm package runs on whatever Node the computer has; an older one fails deep inside a
  // dependency (undici's zstd needs 22.19) before anything of Peer runs, which tells a person
  // nothing, and npm only warns. So this comes before the first import that reaches undici.
  if (npmPeerBin && Number(process.versions.node.split(".")[0]) < 24) {
    process.stderr.write(
      `Peer needs Node 24 or newer; this is Node ${process.versions.node}. Install it (for example \`brew install node@24\`), or run \`npx -p node@24 -p @webinson/peer-core peer …\`.\n`,
    );
    process.exit(1);
  }
  const { keepOutboundFetchOnHttp1 } = await import("./outboundHttp.ts");
  keepOutboundFetchOnHttp1();
  // The npm package's `peer` bin: `peer core <args>` is `t3 peer <args>`, any other `peer <cmd>`
  // goes through the broker as the shim does. The `peer-core` bin is Peer Core itself:
  // `peer-core join <link>` is `t3 peer join <link>`, and `peer-core core <args>` still works.
  // argv[1] becomes the real entry so coreLaunchCommand names bin.mjs, not the link.
  if (npmPeerBin) {
    const coreBin = /^peer-core/.test(NodePath.basename(process.argv[1] ?? ""));
    const [first, ...rest] = process.argv.slice(2);
    // Words only Peer Core has (an agent's `peer` has no login or join): `npx @webinson/peer-core join <link>`
    // runs the `peer` bin, since npx picks it for this package, and must still reach Peer Core.
    const coreOnly = new Set([
      "login",
      "join",
      "logout",
      "serve",
      "stop",
      "connect",
      "disconnect",
      "hooks",
      "bind",
      "tasks",
      "take",
      "create",
      "invite",
      "openspec",
      "unshare",
    ]);
    const args =
      first === "--help" || first === "-h" || first === "help"
        ? ["--help"]
        : first === "core"
          ? rest
          : coreBin || (first !== undefined && coreOnly.has(first))
            ? [first ?? "status", ...rest]
            : ["run", "--", first ?? "status", ...rest];
    process.argv = [process.argv[0]!, NodeFS.realpathSync(process.argv[1]!), "core", ...args];
  }
  const command = process.argv[2];
  // Guard sockets before either dispatch path can load outbound-capable modules.
  const { ignoreMacosTypeOfServiceEinval } = await import("./outboundHttp.ts");
  ignoreMacosTypeOfServiceEinval();
  if (command === "__document-text") {
    const { extractDocumentText } = await import("./provider/documentTextWorker.ts");
    try {
      process.stdout.write(await extractDocumentText(process.argv[3]!, process.argv[4]!));
    } catch (error) {
      if (error instanceof Error && "code" in error && /^E[A-Z0-9]+$/.test(String(error.code))) {
        throw error;
      }
      // Exit 2 identifies document rejections; OS and process failures remain retryable.
      process.exitCode = 2;
    }
  } else if (command === "__managed-chatgpt-token") {
    const { runManagedChatGptTokenCli } = await import("./cli/managedChatGptToken.ts");
    await runManagedChatGptTokenCli(process.argv.slice(3));
  } else if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
    const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
    await runAcpMcpCliFastPath(command, process.argv.slice(3));
  } else {
    enableCliCompileCache();
    // Windows desktop launches without stdin; attach before reading, except on fast paths using pipes.
    const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
    attachConsoleStdin();
    const importStart = performance.now();
    const { runCli } = await import("./binCli.ts");
    if (process.env.T3CODE_STARTUP_PROFILE_DIR) {
      performance.measure("server.import.binCli", { start: importStart });
    }
    runCli(npmPeerBin ? "peer" : "t3");
  }
}
