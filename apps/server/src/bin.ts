/**
 * Every ACP agent spawns `t3 acp-mcp-bridge` while opening its session, and terminal-fallback
 * agents run `t3 acp-mcp-call` per tool call, so their startup sits on first-message latency.
 * Both dispatch here before the full CLI module graph (seconds of evaluation) loads; everything
 * else defers to the real CLI in ./binCli.ts.
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { isEntrypoint } from "./entrypoint.ts";

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
  // goes through the broker as the shim does. The `peer-core` bin, which `npx @webinson/peer-core`
  // runs, is Peer Core itself: `peer-core join <link>` is `t3 peer join <link>` (the command an
  // invitation names), and `peer-core core <args>` still works. argv[1] becomes the real entry so
  // Peer Core's launch command (coreLaunchCommand) names bin.mjs, not the link.
  if (npmPeerBin) {
    const coreBin = /^peer-core/.test(NodePath.basename(process.argv[1] ?? ""));
    const [first, ...rest] = process.argv.slice(2);
    const args =
      first === "core"
        ? rest
        : coreBin
          ? [first ?? "status", ...rest]
          : ["run", "--", first ?? "status", ...rest];
    process.argv = [process.argv[0]!, NodeFS.realpathSync(process.argv[1]!), "peer", ...args];
  }
  const command = process.argv[2];
  if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
    const { runAcpMcpCliFastPath } = await import("./mcp/AcpMcpStdioBridge.ts");
    await runAcpMcpCliFastPath(command, process.argv.slice(3));
  } else {
    // Before anything reads stdin: the desktop app's Windows launcher starts
    // the CLI without one. Never for the fast paths, whose stdin is a pipe.
    const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
    attachConsoleStdin();
    const { runCli } = await import("./binCli.ts");
    runCli();
  }
}
