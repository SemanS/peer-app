/** Git's write-tree merge first shipped in this version. */
export const MIN_GIT = [2, 38] as const;
/** Tip checks while branches qualify, without pairs, and after a commit observation. */
export const POLL_MS = 20_000,
  IDLE_MS = 60_000,
  KICK_MS = 1_000;
/** A changed tip must settle before speculative work. */
export const DEBOUNCE_MS = 5_000;
/** Per repository branches and unordered pairs. */
export const MAX_BRANCHES = 8,
  MAX_PAIRS = 28;
/** Global round work, wall time, and one merge's deadline/output. */
export const MAX_MERGES = 8,
  ROUND_MS = 30_000,
  MERGE_MS = 10_000,
  MERGE_BYTES = 256 * 1024;
/** Wait this multiple of the previous merge's duration, including across rounds. */
export const DUTY_FACTOR = 3;
/** Failed pairs back off; consecutive timeouts open a repository breaker. */
export const BACKOFF_MS = 10 * 60_000,
  MAX_STRIKES = 3,
  PAUSE_MS = 60 * 60_000;
/**
 * The only optional network operation, limited to named origin branches: one question to origin
 * (which of them are pushed) and one fetch of those, together within `FETCH_MS`.
 */
export const FETCH_GAP_MS = 5 * 60_000,
  FETCH_BRANCHES = 10,
  FETCH_MS = 20_000,
  FETCH_LIST_MS = 5_000,
  FETCH_BACKOFF_MS = 15 * 60_000;
/** Advice budgets per session and step. */
export const NOTICE_GAP_MS = 2 * 60_000,
  NOTICE_PAIRS = 3,
  NOTICE_FILES = 3,
  NOTICE_CHARS = 900;
/** Explicit refresh rate and command detail bound. */
export const REFRESH_GAP_MS = 30_000,
  COMMAND_FILES = 20;
/** Wire snapshots and in-memory commit-pair LRU remain bounded. */
export const SNAPSHOT_PAIRS = 30,
  SNAPSHOT_FILES = 20,
  MEMO_ENTRIES = 512;
/** Branch arguments and locally parsed conflict paths. */
export const REF_BYTES = 200,
  MERGE_FILES = 50;
