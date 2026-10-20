// @effect-diagnostics nodeBuiltinImport:off - isolated Codex home and real shell execution.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  codexPeerPluginPaths,
  codexPeerPluginEnabled,
  withCodexPeerPlugin,
} from "./codexPlugin.ts";
import {
  installCodexPeerHooks,
  readCodexPeerHookReview,
  refreshCodexPeerHooks,
  trustCodexPeerHooks,
} from "./codexHooks.ts";
import { codexHookHash } from "./core/adapters/scripts.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);

async function fixture(
  run: (home: string, scripts: { hook: string; wait: string }) => Promise<void>,
) {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer's codex plugin "));
  const scripts = {
    hook: NodePath.join(home, "coord", "hook"),
    wait: NodePath.join(home, "coord", "wait"),
  };
  try {
    await NodeFSP.mkdir(NodePath.dirname(scripts.hook));
    await NodeFSP.writeFile(scripts.hook, '#!/bin/sh\nprintf "%s\\n" "$1"\ncat\n', { mode: 0o700 });
    await run(home, scripts);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
}

describe("Peer's Codex plugin", () => {
  it.each([
    '[plugins]\n"peer@peer" = { enabled = false }\n',
    '[marketplaces]\npeer = { source_type = "local", source = "/elsewhere" }\n',
    '[plugins."peer\\u0040peer"]\nenabled = false\n',
  ])("rejects alternate Peer tables before changing any files: %s", async (config) => {
    await fixture(async (home, scripts) => {
      await NodeFSP.writeFile(NodePath.join(home, "config.toml"), config);
      await expect(installCodexPeerHooks(home, scripts, true)).rejects.toThrow(/review.*Codex/);
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        config,
      );
      await expect(NodeFSP.stat(codexPeerPluginPaths(home).installed)).rejects.toThrow(/ENOENT/);
    });
  });

  it("reads native disablement even in inline and escaped tables", () => {
    assert.isFalse(codexPeerPluginEnabled('[plugins]\n"peer@peer" = { enabled = false }\n'));
    assert.isFalse(codexPeerPluginEnabled('[plugins."peer\\u0040peer"]\nenabled = false\n'));
  });

  it("preserves comments, unrelated tables, and literal path characters", () => {
    const before =
      '# mine\nmodel = "gpt-5"\n["plugins"."peer@peer"]\nenabled = false # off\nextra = true\n';
    const after = withCodexPeerPlugin(before, "/tmp/a$&b#c", true);
    assert.include(
      after,
      '# mine\nmodel = "gpt-5"\n["plugins"."peer@peer"]\nenabled = true # off\nextra = true\n',
    );
    assert.include(after, 'source = "/tmp/a$&b#c"');
    assert.strictEqual(withCodexPeerPlugin(after, "/tmp/a$&b#c", true), after);
  });

  it("installs a named plugin with all lifecycle hooks and forwards payloads to the local app", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const review = await readCodexPeerHookReview(home, scripts);
      assert.isTrue(review.installed);
      assert.isFalse(review.trusted);
      assert.lengthOf(review.hooks, 9);
      assert.isTrue(
        review.hooks.every((hook) => hook.key.startsWith("peer@peer:hooks/hooks.json:")),
      );
      const { installed } = codexPeerPluginPaths(home);
      const manifest = JSON.parse(
        await NodeFSP.readFile(NodePath.join(installed, ".codex-plugin/plugin.json"), "utf8"),
      );
      assert.strictEqual(manifest.interface.displayName, "Peer");
      const { stdout } = await exec(
        "sh",
        ["-c", `printf '{"session_id":"test"}' | sh "$PLUGIN_ROOT/scripts/hook.sh"`],
        {
          env: { ...process.env, PLUGIN_ROOT: installed },
        },
      );
      assert.strictEqual(stdout, 'codex\n{"session_id":"test"}');
    });
  });

  it("removes legacy Peer hooks and relocates foreign trust without approving foreign commands", async () => {
    await fixture(async (home, scripts) => {
      const foreign = { type: "command", command: "echo foreign" };
      const legacy = { type: "command", command: `${scripts.hook} codex`, timeout: 5 };
      const canonical = NodePath.join(await NodeFSP.realpath(home), "hooks.json");
      const oldKey = `${canonical}:stop:1:0`;
      const hash = codexHookHash("Stop", undefined, foreign);
      await NodeFSP.writeFile(
        NodePath.join(home, "hooks.json"),
        JSON.stringify({
          hooks: { Stop: [{ hooks: [legacy] }, { hooks: [foreign] }] },
        }),
      );
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        `[hooks.state.${JSON.stringify(oldKey)}]\ntrusted_hash = "${hash}"\nenabled = false # user disabled\n`,
      );
      await installCodexPeerHooks(home, scripts, true);
      const hooks = JSON.parse(await NodeFSP.readFile(NodePath.join(home, "hooks.json"), "utf8"));
      assert.deepStrictEqual(hooks.hooks.Stop, [{ hooks: [foreign] }]);
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      assert.include(config, `[hooks.state.${JSON.stringify(`${canonical}:stop:0:0`)}]`);
      assert.notInclude(config, oldKey);
      assert.include(config, `trusted_hash = "${hash}"`);
      assert.include(config, "enabled = false # user disabled");
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).trusted);
    });
  });

  it("updates idempotently, honors plugin disablement, and removes only its own package", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const before = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      await installCodexPeerHooks(home, scripts, true);
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        before,
      );
      const review = await readCodexPeerHookReview(home, scripts);
      await trustCodexPeerHooks(home, scripts, review.reviewId);
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        (await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8")).replace(
          '[plugins."peer@peer"]\nenabled = true',
          '[plugins."peer@peer"]\nenabled = false',
        ),
      );
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).trusted);
      await installCodexPeerHooks(home, scripts, false);
      await expect(NodeFSP.stat(codexPeerPluginPaths(home).installed)).rejects.toThrow(/ENOENT/);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).present);
    });
  });

  it("honors native removal and disablement across desktop restarts", async () => {
    await fixture(async (home, scripts) => {
      await refreshCodexPeerHooks(home, scripts, false);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).present);
      await refreshCodexPeerHooks(home, scripts, true);
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).installed);
      const configPath = NodePath.join(home, "config.toml");
      const config = await NodeFSP.readFile(configPath, "utf8");
      await NodeFSP.writeFile(configPath, config.replace("enabled = true", "enabled = false"));
      await refreshCodexPeerHooks(home, scripts, true);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).installed);
      // The native CLI removes the plugin table and cache but retains its local marketplace.
      await NodeFSP.writeFile(
        configPath,
        config.replace(/\[plugins\."peer@peer"\]\nenabled = true\n*/, ""),
      );
      await NodeFSP.rm(codexPeerPluginPaths(home).installed, { recursive: true });
      await refreshCodexPeerHooks(home, scripts, true);
      assert.isFalse((await readCodexPeerHookReview(home, scripts)).present);
      await installCodexPeerHooks(home, scripts, true);
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).installed);
    });
  });

  it("does not let a dev environment redirect another app's plugin", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      await refreshCodexPeerHooks(
        home,
        { ...scripts, hook: NodePath.join(home, "dev", "hook") },
        true,
      );
      assert.isTrue((await readCodexPeerHookReview(home, scripts)).installed);
      assert.strictEqual(
        await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8"),
        config,
      );
    });
  });

  it("preserves disabled events and relocates trust for every shared home alias", async () => {
    await fixture(async (home, scripts) => {
      const foreign = { type: "command", command: "echo foreign" };
      const legacy = { type: "command", command: `${scripts.hook} codex` };
      const alias = NodePath.join(home, "shadow");
      await NodeFSP.mkdir(alias);
      const hookPath = NodePath.join(home, "hooks.json");
      const aliasPath = NodePath.join(alias, "hooks.json");
      await NodeFSP.writeFile(
        hookPath,
        JSON.stringify({ hooks: { Stop: [{ hooks: [legacy, foreign] }] } }),
      );
      await NodeFSP.symlink(hookPath, aliasPath);
      const paths = [
        await NodeFSP.realpath(hookPath),
        NodePath.join(await NodeFSP.realpath(alias), "hooks.json"),
      ];
      const hash = codexHookHash("Stop", undefined, foreign);
      await NodeFSP.writeFile(
        NodePath.join(home, "config.toml"),
        paths
          .map(
            (path) =>
              `[hooks.state.${JSON.stringify(`${path}:stop:0:0`)}]\nenabled = false\n\n` +
              `[hooks.state.${JSON.stringify(`${path}:stop:0:1`)}]\ntrusted_hash = "${hash}"\nenabled = true\n`,
          )
          .join("\n"),
      );
      await installCodexPeerHooks(home, scripts, true);
      const config = await NodeFSP.readFile(NodePath.join(home, "config.toml"), "utf8");
      for (const path of paths) {
        assert.include(
          config,
          `[hooks.state.${JSON.stringify(`${path}:stop:0:0`)}]\ntrusted_hash = "${hash}"`,
        );
        assert.notInclude(config, `${path}:stop:0:1`);
      }
      const review = await readCodexPeerHookReview(home, scripts);
      assert.isFalse(review.hooks.find((hook) => hook.event === "Stop")?.enabled);
      assert.isFalse(review.trusted);
      assert.isTrue(review.hooks.every((hook) => !hook.trusted));
    });
  });

  it("trusts a reviewed plugin with quoted unrelated TOML table names", async () => {
    await fixture(async (home, scripts) => {
      await installCodexPeerHooks(home, scripts, true);
      const configPath = NodePath.join(home, "config.toml");
      const config = (await NodeFSP.readFile(configPath, "utf8")).replace(
        '[plugins."peer@peer"]',
        '["plugins"."peer@peer"]',
      );
      await NodeFSP.writeFile(configPath, config);
      const review = await readCodexPeerHookReview(home, scripts);
      assert.isTrue((await trustCodexPeerHooks(home, scripts, review.reviewId)).trusted);
    });
  });
});
