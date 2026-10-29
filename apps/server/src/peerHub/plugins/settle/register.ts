// @effect-diagnostics nodeBuiltinImport:off - the plugin's atomic local register.
/**
 * The settle register, `settle.json` in this computer's Peer data: the "Resume an ended agent"
 * setting and one entry per overlap and ended session that Peer may resume or must hand over. It is
 * on disk so a Peer restart inside the ten-minute window still resumes once, and an entry that
 * finished stays until it is pruned so the same pair is never resumed twice.
 *
 * @module peerHub/plugins/settle/register
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { SETTLE_HANDOVER_REASONS, SETTLE_RESUME_DEFAULT } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const Reason = Schema.Literals(
  Object.keys(SETTLE_HANDOVER_REASONS) as Array<keyof typeof SETTLE_HANDOVER_REASONS>,
);

export const SettleEntry = Schema.Struct({
  overlap: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  session: Schema.String,
  agent: Schema.String,
  nativeId: Schema.String,
  cwd: Schema.String,
  task: Schema.optional(Schema.String),
  /** False for a session no CLI can resume (MCP-only, other agents): it is handed over. */
  resumable: Schema.Boolean,
  endedAt: Schema.String,
  /**
   * How many notes the session had written on the overlap when it ended and when the resumption
   * started: one more is its answer. Counting keeps the answer independent of the clocks of the Hub
   * and of other computers.
   */
  notesAtEnd: Schema.Number,
  attempts: Schema.Number,
  startedAt: Schema.optional(Schema.String),
  notesAtStart: Schema.optional(Schema.Number),
  /** A handover note still to be written (the Hub could not be reached). */
  handover: Schema.optional(Reason),
  /** When it finished: settled, dropped or handed over. Kept until pruned so it is not resumed again. */
  doneAt: Schema.optional(Schema.String),
});
export type SettleEntry = typeof SettleEntry.Type;

const Register = Schema.Struct({
  version: Schema.Literal(1),
  resume: Schema.Boolean,
  entries: Schema.Array(SettleEntry),
});
export type SettleRegister = typeof Register.Type;
const decodeRegister = Schema.decodeUnknownOption(Schema.fromJsonString(Register));

export const emptyRegister = (): SettleRegister => ({
  version: 1,
  resume: SETTLE_RESUME_DEFAULT,
  entries: [],
});

export const entryKey = (entry: Pick<SettleEntry, "overlap" | "session">) =>
  `${entry.overlap} ${entry.session}`;

export interface RegisterIO {
  readonly read: () => Promise<SettleRegister>;
  readonly write: (register: SettleRegister) => Promise<void>;
}

export const fileRegister = (directory: string): RegisterIO => {
  const target = NodePath.join(directory, "settle.json");
  return {
    read: async () => {
      let raw: string;
      try {
        raw = await NodeFSP.readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRegister();
        throw error;
      }
      const decoded = decodeRegister(raw);
      // A register Peer cannot read resumes nobody: the window of what it held is short anyway.
      return Option.isSome(decoded) ? decoded.value : emptyRegister();
    },
    write: async (register) => {
      await NodeFSP.mkdir(directory, { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      await NodeFSP.writeFile(temp, JSON.stringify(register) + "\n", { mode: 0o600 });
      await NodeFSP.rename(temp, target);
    },
  };
};
