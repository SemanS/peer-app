// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off globalFetch:off globalFetchInEffect:off preferSchemaOverJson:off - opt-in isolated protocol lab.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";
import type { PeerImpactView } from "@t3tools/contracts";

/** Replays captured 0.50 shapes, with ranges matching the lab's two tiny source files. */
export function installImpactGraph(directory: string) {
  const fixture = NodePath.resolve(
      import.meta.dirname,
      "../../src/peerHub/plugins/impact/__fixtures__/codegraph-0.50",
    ),
    binary = NodePath.join(directory, "fake-impact-codegraph"),
    calls = NodePath.join(directory, "impact-codegraph-calls.jsonl");
  const program = `#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),fixture=${JSON.stringify(fixture)};
const read=name=>JSON.parse(fs.readFileSync(fixture+'/'+name+'.json','utf8'));
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args,cwd:process.cwd()})+'\\n');
let value;
if(args[0]==='status')value=read('ready');
else if(args[0]==='node'){value=read(args[1]==='src/money.ts'?'node-money':'node-receipt');if(value.query!==args[1]){value={command:'node',isError:false,query:args[1],output:'**'+args[1]+'** — 0 symbols'};}}
else if(args[0]==='search'){const name=args[1],money=name==='formatPrice',line=money||name==='./money'?1:2;value=[{node:{...read('search')[0].node,name,filePath:money?'src/money.ts':'src/receipt.ts',startLine:line,endLine:line,signature:money?'(value: number, currency?: string): string':name==='receiptLine'?'(value: number): string':'import'}}];}
else if(args[0]==='callees'){value=read('callees');if(args[1]!=='receiptLine')value={...value,callees:[]};}
else {process.stderr.write('read-only fixture command refused');process.exit(3);}
process.stdout.write(JSON.stringify(value));
`;
  NodeFS.writeFileSync(binary, program, { mode: 0o700 });
  return binary;
}
export function impactBaseline(root: string) {
  NodeFS.writeFileSync(
    NodePath.join(root, "src/money.ts"),
    "export function formatPrice(value: number): string { return String(value); }\n",
  );
  NodeFS.writeFileSync(
    NodePath.join(root, "src/receipt.ts"),
    'import { formatPrice } from "./money";\nexport function receiptLine(value: number): string { return formatPrice(value); }\n',
  );
}
interface Agent {
  readonly name: string;
  start: () => unknown;
  edit: (event: "PostToolUse" | "PreToolUse", path: string) => unknown;
  hook: (event: string, extra?: Record<string, unknown>) => unknown;
  peer: (...args: string[]) => string;
}
/** Only the owning lab process opens this proxy; auth and streams remain inside its private Hub. */
export async function withoutImpactRoutes(upstream: string) {
  let missing = 0;
  const server = NodeHttp.createServer(async (request, response) => {
    try {
      if (/\/impact(?:\/|\?|$)/.test(request.url ?? "")) {
        missing++;
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "not_found", message: "no such route" } }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers))
        if (value !== undefined && !["host", "connection", "content-length"].includes(key))
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const reply = await fetch(upstream + (request.url ?? "/"), {
        method: request.method ?? "GET",
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const responseHeaders = new Headers(reply.headers);
      responseHeaders.delete("content-length");
      responseHeaders.delete("content-encoding");
      response.writeHead(reply.status, Object.fromEntries(responseHeaders));
      if (reply.body) {
        const stream = NodeStream.Readable.fromWeb(reply.body);
        stream.on("error", () => response.destroy());
        response.once("close", () => stream.destroy());
        stream.pipe(response);
      } else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing lab proxy address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    missing: () => missing,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
export async function impactLab(input: {
  agents: readonly [Agent, Agent];
  roots: readonly [string, string];
  view: () => Promise<PeerImpactView>;
  dismiss: (id: string) => Promise<unknown>;
  reopen: (id: string) => Promise<unknown>;
  setEnabled: (enabled: boolean) => Promise<unknown>;
  changed: () => void;
  check: (okay: unknown, description: string) => void;
  pause: (ms: number) => Promise<void>;
  say: (label: string, text: string) => void;
  events: () => ReadonlyArray<{ event: string; session?: string }>;
}) {
  const { agents, check, pause, say } = input;
  for (const a of agents) a.start();
  input.changed();
  agents[0].edit("PostToolUse", "src/money.ts");
  agents[1].edit("PostToolUse", "src/receipt.ts");
  let view: PeerImpactView = { records: [], provided: [] };
  for (let i = 0; i < 120; i++) {
    view = await input.view();
    if (
      view.records.some(
        (r) => r.live && r.state === "open" && r.items.some((item) => item.name === "formatPrice"),
      )
    )
      break;
    await pause(500);
  }
  const record = view.records.find(
    (r) => r.live && r.state === "open" && r.items.some((item) => item.name === "formatPrice"),
  );
  check(record, "two computers pair a changed signature with receiptLine's use");
  if (!record) throw new Error("missing impact record");
  for (const a of agents) {
    const first = JSON.stringify(a.hook("UserPromptSubmit", { prompt: "continue" }));
    say(a.name, first);
    check(
      first.includes("impact (advice)") &&
        first.includes("formatPrice") &&
        first.includes("receiptLine"),
      "both sides hear the impact fact at their next step",
    );
    check(
      !JSON.stringify(a.hook("UserPromptSubmit", { prompt: "continue again" })).includes(
        "impact (advice)",
      ),
      "each side hears the impact fact once",
    );
  }
  await input.dismiss(record.id);
  for (const a of agents) {
    a.hook("SessionStart", { source: "compact" });
    check(
      !JSON.stringify(a.hook("UserPromptSubmit", { prompt: "continue" })).includes(
        "impact (advice)",
      ),
      "dismissal silences even fresh compact advice",
    );
  }
  await input.reopen(record.id);
  check(
    (await input.view()).records.some((r) => r.id === record.id && r.state === "open"),
    "a person can reopen an impact overlap",
  );
  await input.setEnabled(false);
  for (let i = 0; i < 40; i++) {
    if (!(await input.view()).records.some((r) => r.id === record.id && r.state === "open")) break;
    await pause(500);
  }
  check(
    !(await input.view()).records.some((r) => r.id === record.id && r.state === "open"),
    "turning Impact off reports empty footprints and clears the pair",
  );
  const events = input.events().filter((e) => e.event === "impact.told");
  for (const session of ["claude:lab-impact-ana", "claude:lab-impact-bob"])
    check(
      events.filter((e) => e.session === session).length === 1,
      "content-free logs record one advice delivery per side",
    );
  for (const a of agents) a.hook("SessionEnd", { reason: "exit" });
  await input.setEnabled(true);
}
