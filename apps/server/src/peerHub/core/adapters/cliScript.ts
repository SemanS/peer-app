import { TEXT } from "../broker/cliContract.ts";

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** The command's credentials stay in a private header file, never curl's process arguments. */
export function cliScript(socket: string, waits: ReadonlyArray<readonly [string, number]>): string {
  return `#!/bin/sh
cmd="\${1:-status}"
[ $# -gt 0 ] && shift
say() { printf '%s\\nNext: %s\\n' "$1" "$2" >&2; }
next=${quote(TEXT.check)}
[ "$cmd" = request ] && next=${quote(TEXT.repeat)}
uncertain() { line=$(printf ${quote(TEXT.uncertain)} "$1" "$cmd"); say "$line" "$next"; exit 4; }
case "$cmd" in ''|*[!A-Za-z0-9_.-]*) say "$(printf ${quote(TEXT.name)} "$cmd")" ${quote(TEXT.help)}; exit 2;; esac
max="\${PEER_CLI_TIMEOUT:-}"
case "$max" in ''|*[!0-9.]*|*.*.*) max=;; *[1-9]*) ;; *) max=;; esac
if [ -z "$max" ]; then
max=15
${waits.map(([name, seconds]) => `[ "$cmd" = ${quote(name)} ] && max=${seconds}\n`).join("")}fi
umask 077
work=$(mktemp -d "\${TMPDIR:-/tmp}/peer-cli.XXXXXX" 2>/dev/null) || { say ${quote(TEXT.temp)} ${quote(TEXT.tempNext)}; exit 3; }
trap 'rm -rf "$work"' 0
clean() { printf '%s' "$1" | tr -d '\\r\\n'; }
token="\${PEER_SESSION_TOKEN:-}"
# A Claude Mod running this session keeps its token where no env file a hook wrote can shadow it.
[ -n "\${PEER_MOD_SESSION_TOKEN:-}" ] && [ -n "\${PEER_SESSION:-}" ] && [ "\${PEER_MOD_SESSION:-}" = "$PEER_SESSION" ] && token=$PEER_MOD_SESSION_TOKEN
# An MCP client may start its server outside the project (some editors use /): PEER_CWD names it.
cwd=$PWD
[ "$cmd" = mcp ] && [ -n "\${PEER_CWD:-}" ] && cwd=$PEER_CWD
{
printf 'X-Peer-Session: %s\\n' "$(clean "\${PEER_SESSION:-\${CODEX_THREAD_ID:-}}")"
[ -z "$token" ] || printf 'X-Peer-Session-Token: %s\\n' "$(clean "$token")"
printf 'X-Peer-Cwd: %s\\n' "$(clean "$cwd")"
} > "$work/headers"
if [ "$cmd" = mcp ]; then
[ $# -eq 0 ] || { say 'peer: usage: mcp takes no arguments.' 'run peer mcp from an MCP client.'; exit 2; }
[ "\${PEER_COORDINATION:-}" != off ] || { say 'peer: refused: coordination is turned off.' 'ask your person to turn coordination on in Peer.'; exit 3; }
{
printf 'X-Peer-Mcp: mcp-%s-%s\\n' "$$" "$(date +%s)"
printf 'X-Peer-Thread: %s\\n' "$(clean "\${PEER_THREAD:-}")"
printf 'X-Peer-Harness: %s\\n' "$(clean "\${PEER_HARNESS:-}")"
printf 'X-Herdr-Pane: %s\\n' "$(clean "\${HERDR_PANE_ID:-}")"
} >> "$work/headers"
mcp_send() {
status=$(printf '%s\\0' "$1" | curl -s --max-time 30 --unix-socket ${quote(socket)} -H @"$work/headers" --data-binary @- -o "$work/body" -w '%{http_code}' http://peer/cli/mcp 2>/dev/null)
code=$?
case "$code" in
0) ;;
7|127) say ${quote(TEXT.notRunning)} ${quote(TEXT.start)}; exit 5;;
28) uncertain 'Peer did not answer within 30 s';;
*) uncertain ${quote(TEXT.lost)};;
esac
case "$status" in
2??) [ ! -s "$work/body" ] || cat "$work/body";;
400) if [ -s "$work/body" ]; then cat "$work/body" >&2; else say 'peer: usage: Peer rejected the MCP request.' 'check the MCP client configuration.'; fi; exit 2;;
409) if [ -s "$work/body" ]; then cat "$work/body" >&2; else say 'peer: refused: Peer declined the MCP request.' 'check the coordination plugin in Peer settings.'; fi; exit 3;;
*) if [ -s "$work/body" ]; then cat "$work/body" >&2; else say 'peer: uncertain: Peer could not answer the MCP request.' 'run peer status before retrying.'; fi; exit 4;;
esac
}
while IFS= read -r line || [ -n "$line" ]; do mcp_send "$line"; done
mcp_send --end
exit 0
fi
status=$(for arg in "$@"; do printf '%s\\0' "$arg"; done | curl -s --max-time "$max" --unix-socket ${quote(socket)} -H @"$work/headers" --data-binary @- -o "$work/body" -w '%{http_code}' "http://peer/cli/$cmd" 2>/dev/null)
code=$?
case "$code" in
0) ;;
7|127) say ${quote(TEXT.notRunning)} ${quote(TEXT.start)}; exit 5;;
28) uncertain "$(printf ${quote(TEXT.timeout)} "$max")";;
*) uncertain ${quote(TEXT.lost)};;
esac
failure() { if [ -s "$work/body" ]; then cat "$work/body" >&2; else say "$1" "$2"; fi; }
case "$status" in
2??) cat "$work/body"; exit 0;;
400) failure 'peer: usage: Peer rejected the command arguments.' ${quote(TEXT.help)}; exit 2;;
409) failure 'peer: refused: Peer declined the command.' 'run peer status and follow the requirements before retrying.'; exit 3;;
500) failure "$(printf ${quote(TEXT.uncertain)} ${quote(TEXT.broker)} "$cmd")" "$next"; exit 4;;
*) uncertain "Peer answered with unexpected HTTP $status";;
esac
`;
}
