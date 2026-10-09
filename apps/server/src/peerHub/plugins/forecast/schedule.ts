import type { MergeResult } from "./git.ts";
import {
  BACKOFF_MS,
  DEBOUNCE_MS,
  DUTY_FACTOR,
  MAX_MERGES,
  MAX_STRIKES,
  MEMO_ENTRIES,
  PAUSE_MS,
} from "./limits.ts";
export type Candidate = {
  key: string;
  repository: string;
  a: string;
  b: string;
  refs: readonly [string, string];
};
export const commitPair = (pair: Pick<Candidate, "a" | "b">) => [pair.a, pair.b].sort().join("/");
export function newSchedule() {
  return {
    tips: new Map<string, { id: string; changedAt: number }>(),
    memo: new Map<string, { result: MergeResult; checkedAt: number; retryAt: number }>(),
    strikes: new Map<string, number>(),
    paused: new Map<string, number>(),
    nextMergeAt: 0,
  };
}
export type ScheduleState = ReturnType<typeof newSchedule>;
export function resultOf(state: ScheduleState, pair: Pick<Candidate, "a" | "b">) {
  const key = commitPair(pair),
    result = state.memo.get(key);
  if (result !== undefined) {
    state.memo.delete(key);
    state.memo.set(key, result);
  }
  return result;
}
export function observeTips(state: ScheduleState, tips: ReadonlyMap<string, string>, now: number) {
  for (const [ref, id] of tips) {
    const previous = state.tips.get(ref);
    if (previous?.id !== id)
      state.tips.set(ref, {
        id,
        changedAt: previous === undefined ? Number.NEGATIVE_INFINITY : now,
      });
  }
  for (const ref of state.tips.keys()) if (!tips.has(ref)) state.tips.delete(ref);
}
export function candidates<P extends Candidate>(
  state: ScheduleState,
  pairs: ReadonlyArray<P>,
  now: number,
  force = false,
) {
  if (now < state.nextMergeAt) return [];
  return pairs
    .filter((pair) => {
      if ((state.paused.get(pair.repository) ?? 0) > now) return false;
      const memo = resultOf(state, pair);
      if (memo !== undefined && (memo.retryAt === Infinity || memo.retryAt > now)) return false;
      return (
        force ||
        pair.refs.every((ref) => now - (state.tips.get(ref)?.changedAt ?? now) >= DEBOUNCE_MS)
      );
    })
    .sort(
      (a, b) =>
        Math.max(...b.refs.map((r) => state.tips.get(r)?.changedAt ?? 0)) -
          Math.max(...a.refs.map((r) => state.tips.get(r)?.changedAt ?? 0)) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, MAX_MERGES);
}
export function recordResult(
  state: ScheduleState,
  pair: Candidate,
  result: MergeResult,
  started: number,
  duration: number,
) {
  const end = started + duration,
    key = commitPair(pair);
  state.memo.delete(key);
  state.memo.set(key, {
    result,
    checkedAt: end,
    retryAt: result.state === "slow" || result.state === "failed" ? end + BACKOFF_MS : Infinity,
  });
  while (state.memo.size > MEMO_ENTRIES) state.memo.delete(state.memo.keys().next().value!);
  state.nextMergeAt = end + DUTY_FACTOR * duration;
  if (result.state === "slow") {
    const strikes = (state.strikes.get(pair.repository) ?? 0) + 1;
    state.strikes.set(pair.repository, strikes);
    if (strikes >= MAX_STRIKES) state.paused.set(pair.repository, end + PAUSE_MS);
  } else if (result.state === "clean" || result.state === "conflict") {
    state.strikes.delete(pair.repository);
    state.paused.delete(pair.repository);
  }
}
