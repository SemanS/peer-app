import { usage } from "../../core/plugin.ts";
export function resourceName(target: string) {
  const name = target.slice("resource:".length).toLowerCase();
  if (!target.startsWith("resource:") || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(name))
    throw usage(
      "Invalid resource name.",
      "use resource:deploy-staging (1–64 letters, digits, dots, underscores, colons or hyphens).",
    );
  return name;
}
export function leaseSeconds(ttl: string | undefined) {
  if (ttl === undefined) return 1800;
  const match = /^(\d+)(s|m|h)$/.exec(ttl);
  const seconds = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600 }[match[2]!] ?? 0) : 0;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 28800)
    throw usage(
      "A resource lease is 1 minute to 8 hours.",
      "use --ttl 30m, --ttl 60s or --ttl 8h.",
    );
  return seconds;
}
