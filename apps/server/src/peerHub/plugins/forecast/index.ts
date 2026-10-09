import { PEER_FORECAST_METHODS, WsPeerForecastRpcGroup } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { bindPlugin, usage, type PeerContributions } from "../../core/plugin.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { Forecast, layer } from "./ForecastService.ts";
import { notice, resetAdvice, forecastText } from "./advice.ts";
export const make = Effect.gen(function* () {
  const forecast = yield* Forecast,
    agents = yield* PeerAgents;
  return {
    commands: [
      {
        name: "forecast",
        usage: "forecast",
        summary: "merge predictions for this branch",
        waitSeconds: 40,
        run: ({ session, args }) =>
          Effect.gen(function* () {
            if (args.length)
              return yield* Effect.fail(
                usage("peer forecast takes no arguments", "run peer forecast."),
              );
            const snapshot = yield* forecast.refresh(session);
            return forecastText(
              snapshot,
              forecast.forSession(session),
              session,
              yield* Clock.currentTimeMillis,
            );
          }),
      },
    ],
    hooks: {
      sessionStart: ({ session }) =>
        Effect.sync(() => {
          resetAdvice(session);
          return null;
        }),
      notices: [
        {
          wakes: false,
          read: (ctx) =>
            Effect.gen(function* () {
              if (
                ctx.waking ||
                ctx.session.adapter === "mcp" ||
                !["claude", "codex"].includes(ctx.session.agent) ||
                (yield* forecast.read).state !== "on"
              )
                return null;
              const text = notice(
                ctx.session,
                forecast.forSession(ctx.session),
                yield* Clock.currentTimeMillis,
              );
              if (text !== null)
                yield* agents.log("forecast.told", {
                  session: ctx.session.id,
                  pairs: forecast.forSession(ctx.session).length,
                  chars: text.length,
                });
              return text;
            }),
        },
      ],
      stop: () => forecast.kick,
      postTool: (ctx) =>
        ctx.command !== undefined &&
        /\bgit\s+(?:commit|merge|rebase|pull|cherry-pick|am|revert|reset)\b/.test(ctx.command)
          ? forecast.kick.pipe(Effect.as(null))
          : Effect.succeed(null),
    },
    rpc: {
      group: WsPeerForecastRpcGroup,
      handlers: (wrap) =>
        WsPeerForecastRpcGroup.of({
          [PEER_FORECAST_METHODS.peerForecastSubscribe]: () =>
            wrap.stream(PEER_FORECAST_METHODS.peerForecastSubscribe, forecast.changes),
          [PEER_FORECAST_METHODS.peerForecastConfigure]: (input) =>
            wrap.effect(PEER_FORECAST_METHODS.peerForecastConfigure, forecast.configure(input)),
        }),
    },
    lifecycle: (event) =>
      event.kind === "signed-in"
        ? forecast.boot.pipe(Effect.andThen(forecast.kick), Effect.ignore)
        : forecast.kick,
    workspaceCleanup: (event) =>
      event.kind === "signing-out"
        ? forecast.forget()
        : event.kind === "left-workspace"
          ? forecast.forget(event.workspace)
          : Effect.void,
    turnOff: forecast.stop,
    run: forecast.run,
  } satisfies PeerContributions;
});
export const ForecastPlugin = bindPlugin({
  id: "forecast",
  title: "Merge conflict forecast",
  summary: "Advice about committed branch conflicts, computed only on this computer.",
  defaultEnabled: true,
  layer,
  make,
});
