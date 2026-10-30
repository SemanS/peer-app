// @effect-diagnostics nodeBuiltinImport:off - a run id's randomness.
/**
 * Run ids (design D1), apart from the runs themselves so the state can mint them for the assignments
 * it turns into runs on load (`legacyAssignments.ts`).
 *
 * @module peerHub/core/state/runIds
 */
import * as NodeCrypto from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * `run_` and 20 Crockford base-32 characters of a ULID: its 10 time characters, so ids sort by
 * start, and the first 10 of its randomness.
 */
export function mintRunId(now: number, random: Buffer = NodeCrypto.randomBytes(7)): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = `${CROCKFORD[rest % 32]}${time}`;
    rest = Math.floor(rest / 32);
  }
  let bits = BigInt(`0x${random.toString("hex").padStart(14, "0")}`);
  let tail = "";
  for (let i = 0; i < 10; i++) {
    tail = `${CROCKFORD[Number(bits & 31n)]}${tail}`;
    bits >>= 5n;
  }
  return `run_${time}${tail}`;
}
