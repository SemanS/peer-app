import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { makeCatchup } from "./catchup.ts";
it("needs an agent session like status and lists help only while active", async () => {
  let active = true;
  const service = makeCatchup({
    fetchDigest: () => Effect.succeed(null),
    nameOf: (e) => e,
    email: () => "ana",
    now: () => 0,
    log: () => undefined,
  });
  const command = {
    name: "catchup",
    usage: "catchup [--since 8h]",
    summary: "what the team did while you were away; later calls say only what is new",
    run: ({ session, args }: import("../../core/plugin.ts").PeerCommandInput) =>
      service.run(session, args),
  };
  const fixture = await brokerFixture(() => ({
    plugins: async () => ({
      ...NO_PLUGINS,
      commands: [{ plugin: "digest", command, ...(active ? {} : { refused: "off" as const }) }],
    }),
  }));
  try {
    expect(await fixture.broker.runCli("help", [], {})).toContain("catchup [--since 8h]");
    await expect(fixture.broker.runCli("catchup", [], {})).rejects.toMatchObject({
      outcome: "refused",
    });
    await fixture.register("one");
    expect(
      await fixture.broker.runCli("catchup", [], { "x-peer-session": "claude:one" }),
    ).toContain("peer log");
    active = false;
    expect(await fixture.broker.runCli("help", [], {})).not.toContain("catchup [--since 8h]");
    await expect(
      fixture.broker.runCli("catchup", [], { "x-peer-session": "claude:one" }),
    ).rejects.toMatchObject({ outcome: "refused" });
  } finally {
    await fixture.dispose();
  }
});
