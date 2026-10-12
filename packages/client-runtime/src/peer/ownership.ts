/**
 * The ownership plugin's client logic, for web and the phone alike: who owns a task, an area and
 * a path, whom a review asks, which owner's calls wait on whom (`ownershipRules.ts`, which
 * `work.ts` and `needsYou.ts` build the board and Needs you on).
 *
 * @module peer/ownership
 */
export * from "./ownershipRules.ts";
