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
{
printf 'X-Peer-Session: %s\\n' "$(clean "\${PEER_SESSION:-\${CODEX_THREAD_ID:-}}")"
[ -z "\${PEER_SESSION_TOKEN:-}" ] || printf 'X-Peer-Session-Token: %s\\n' "$(clean "$PEER_SESSION_TOKEN")"
printf 'X-Peer-Cwd: %s\\n' "$(clean "$PWD")"
} > "$work/headers"
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
