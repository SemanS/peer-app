import type { PeerSharedKey } from "@t3tools/contracts";

/** Older Hubs omit sharedKeys; they cannot tell us whether a provider was revoked or must rotate. */
export function planSharedKeys(
  local: Readonly<
    Record<
      string,
      { readonly keyRef?: string | undefined; readonly expiresAt?: string | null | undefined }
    >
  >,
  manifestKeys: ReadonlyArray<PeerSharedKey> | undefined,
  environment: string,
  now: number,
) {
  const rotate: string[] = [],
    drop: string[] = [];
  const adopt: Record<
    string,
    { readonly keyRef: string; readonly expiresAt?: string | null | undefined }
  > = {};
  if (manifestKeys === undefined) return { rotate, drop, adopt };
  for (const [project, saved] of Object.entries(local)) {
    const key = manifestKeys.find(
      (k) =>
        k.project === project &&
        k.environment === environment &&
        (saved.keyRef === undefined || saved.keyRef === k.keyRef),
    );
    if (key === undefined) {
      drop.push(project);
      continue;
    }
    if (saved.keyRef === undefined)
      adopt[project] = {
        keyRef: key.keyRef,
        ...(key.expiresAt === undefined ? {} : { expiresAt: key.expiresAt }),
      };
    const expires = Date.parse(key.expiresAt ?? "");
    if (Number.isFinite(expires) && expires - now <= 7 * 24 * 60 * 60 * 1000) rotate.push(project);
  }
  return { rotate, drop, adopt };
}
