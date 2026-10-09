// @effect-diagnostics nodeBuiltinImport:off - the plugin's atomic local alert ledger.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { isNeedsYouPushId } from "@t3tools/contracts";
import { RelayAgentActivityState } from "@t3tools/contracts/relay";

const Ledger = Schema.Struct({
  version: Schema.Literal(1),
  alerts: Schema.Boolean,
  published: Schema.Record(
    Schema.String,
    Schema.Struct({ phase: RelayAgentActivityState.fields.phase, since: Schema.String }),
  ),
});
const decodeLedger = Schema.decodeUnknownOption(Schema.fromJsonString(Ledger));
export type AlertLedger = typeof Ledger.Type;
export const emptyLedger = (): AlertLedger => ({ version: 1, alerts: false, published: {} });
export interface LedgerIO {
  readonly read: () => Promise<AlertLedger>;
  readonly write: (ledger: AlertLedger) => Promise<void>;
}
export const fileLedger = (directory: string): LedgerIO => {
  const target = NodePath.join(directory, "needs-you.json");
  return {
    read: async () => {
      let raw: string;
      try {
        raw = await NodeFSP.readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger();
        throw error;
      }
      const decoded = decodeLedger(raw);
      if (Option.isNone(decoded)) throw new Error("Invalid local Needs You ledger.");
      return {
        ...decoded.value,
        published: Object.fromEntries(
          Object.entries(decoded.value.published).filter(
            ([id, row]) => isNeedsYouPushId(id) && Number.isFinite(Date.parse(row.since)),
          ),
        ),
      };
    },
    write: async (ledger) => {
      await NodeFSP.mkdir(directory, { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      await NodeFSP.writeFile(temp, JSON.stringify(ledger) + "\n", { mode: 0o600 });
      await NodeFSP.rename(temp, target);
    },
  };
};
