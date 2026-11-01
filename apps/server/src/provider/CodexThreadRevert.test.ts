import { assert, it } from "@effect/vitest";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as Effect from "effect/Effect";

import { revertCodexThread } from "./CodexThreadRevert.ts";

const userMessage = {
  type: "userMessage",
  id: "user-item",
  content: [{ type: "text", text: "a prompt", text_elements: [] }],
};
const agentMessage = { type: "agentMessage", id: "agent-item", text: "a reply" };

interface TurnFixture {
  readonly id: string;
  readonly items?: ReadonlyArray<object>;
  readonly status?: string;
}

/** Names alone are ordinary turns; `thread/turns/list` gives those their prompt in summary view. */
const turnFrame = (turn: string | TurnFixture) => {
  const {
    id,
    items = [userMessage, agentMessage],
    status = "completed",
  } = typeof turn === "string" ? { id: turn } : turn;
  return { id, items, status, error: null };
};
const emptyTurn = (id: string): TurnFixture => ({ id, items: [] });

const page = (
  id: number,
  cursor: string | null,
  limit: number,
  turns: ReadonlyArray<string | TurnFixture>,
  nextCursor: string | null,
) => [
  {
    type: "expect_outbound" as const,
    frame: {
      id,
      method: "thread/turns/list",
      params: {
        threadId: "thread",
        cursor,
        limit,
        sortDirection: "desc",
        itemsView: "summary",
      },
    },
  },
  {
    type: "emit_inbound" as const,
    frame: {
      id,
      result: {
        data: turns.map(turnFrame),
        nextCursor,
      },
    },
  },
];

it.effect("finds the revert boundary across pages of newest-first turns", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    const result = yield* revertCodexThread(client, "thread", 3, new Set()).pipe(Effect.flip);
    assert.equal(result.message, "boundary reached");
  }).pipe(
    Effect.provide(
      CodexReplay.layerReplay({
        provider: "codex",
        protocol: "codex.app-server",
        version: "test",
        scenario: "revert-pages",
        entries: [
          ...page(1, null, 3, ["newest", "middle"], "older"),
          ...page(2, "older", 1, ["boundary"], null),
          {
            type: "expect_outbound",
            frame: {
              id: 3,
              method: "thread/revert",
              params: { threadId: "thread", beforeTurnId: "boundary" },
            },
          },
          {
            type: "emit_inbound",
            frame: { id: 3, error: { code: -32603, message: "boundary reached" } },
          },
        ],
      }),
    ),
    Effect.scoped,
  ),
);

const revertsTo = (
  scenario: string,
  beforeTurnId: string,
  numTurns: number,
  heldNativeTurnIds: ReadonlySet<string>,
  pages: ReadonlyArray<Parameters<typeof page>>,
) =>
  it.effect(scenario, () =>
    Effect.gen(function* () {
      const client = yield* CodexClient.CodexAppServerClient;
      const result = yield* revertCodexThread(client, "thread", numTurns, heldNativeTurnIds).pipe(
        Effect.flip,
      );
      assert.equal(result.message, "boundary reached");
    }).pipe(
      Effect.provide(
        CodexReplay.layerReplay({
          provider: "codex",
          protocol: "codex.app-server",
          version: "test",
          scenario,
          entries: [
            ...pages.flatMap((args) => page(...args)),
            {
              type: "expect_outbound",
              frame: {
                id: pages.length + 1,
                method: "thread/revert",
                params: { threadId: "thread", beforeTurnId },
              },
            },
            {
              type: "emit_inbound",
              frame: {
                id: pages.length + 1,
                error: { code: -32603, message: "boundary reached" },
              },
            },
          ],
        }),
      ),
      Effect.scoped,
    ),
  );

revertsTo("skips a CLI compact and takes the turn before it", "before-compact", 3, new Set(), [
  [1, null, 3, ["later", "after", emptyTurn("cli-compact"), "before-compact"], null],
]);

revertsTo("pages past a skipped turn when the limit is used up", "before-compact", 1, new Set(), [
  [1, null, 1, [emptyTurn("cli-compact")], "older"],
  [2, "older", 1, ["before-compact"], null],
]);

revertsTo(
  "counts an empty turn Peer holds, which is its own compact",
  "peer-compact",
  2,
  new Set(["peer-compact"]),
  [[1, null, 2, ["later", emptyTurn("peer-compact")], "older"]],
);

revertsTo(
  "counts a goal turn with no user message, and an interrupted one",
  "interrupted",
  2,
  new Set(),
  [
    [
      1,
      null,
      2,
      [
        { id: "goal-continuation", items: [agentMessage] },
        { id: "interrupted", items: [userMessage], status: "interrupted" },
      ],
      "older",
    ],
  ],
);

it.effect("rejects repeated cursors instead of looping or reverting incomplete history", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    const result = yield* revertCodexThread(client, "thread", 3, new Set()).pipe(Effect.flip);
    assert.equal(result.message, "Thread history pagination repeated a cursor.");
  }).pipe(
    Effect.provide(
      CodexReplay.layerReplay({
        provider: "codex",
        protocol: "codex.app-server",
        version: "test",
        scenario: "revert-loop",
        entries: [...page(1, null, 3, ["newest"], "again"), ...page(2, "again", 2, [], "again")],
      }),
    ),
    Effect.scoped,
  ),
);
