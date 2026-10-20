import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as HostProcess from "../../../packages/shared/src/hostProcess.ts";

const matrix = {
  "mac-arm64": ["aarch64-apple-darwin"],
  "mac-x64": ["x86_64-apple-darwin"],
  "mac-universal": ["aarch64-apple-darwin", "x86_64-apple-darwin"],
  "linux-arm64": ["aarch64-unknown-linux-gnu"],
  "linux-x64": ["x86_64-unknown-linux-gnu"],
  "win-arm64": ["aarch64-pc-windows-msvc"],
  "win-x64": ["x86_64-pc-windows-msvc"],
};
const source = JSON.parse(
  NodeFS.readFileSync(process.env.KONTEXT_SOURCE_MANIFEST || "scripts/kontext-source.json", "utf8"),
);
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) ||
  !/^[a-f0-9]{40}$/.test(source.revision) ||
  source.api_version !== 1
) {
  throw new Error("kontext-source.json must pin a GitHub repository, full commit and API v1");
}
const target = `${process.env.KONTEXT_TARGET_PLATFORM}-${process.env.KONTEXT_TARGET_ARCH}`;
const triples = matrix[target];
if (!triples) throw new Error(`Unsupported kontext packaging target: ${target}`);
if (process.env.KONTEXT_RUST_TARGET && !triples.includes(process.env.KONTEXT_RUST_TARGET)) {
  throw new Error("Desktop Rust target does not match the requested kontext platform/architecture");
}
const hostPlatform = { darwin: "mac", linux: "linux", win32: "win" }[
  HostProcess.Platform.defaultValue()
];
if (hostPlatform !== process.env.KONTEXT_TARGET_PLATFORM) {
  throw new Error("Build kontext on the target operating system; cross-OS linking is unsupported");
}
const describe = () => {
  const output = `repository=${source.repository}\nrevision=${source.revision}\nrust_targets=${triples.join(",")}\n`;
  if (process.env.GITHUB_OUTPUT) NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, output);
  else process.stdout.write(output);
};
if (process.argv[2] === "describe") {
  describe();
} else {
  const root = NodePath.resolve(process.env.KONTEXT_ENGINE_SOURCE || ".kontext-engine");
  const buildRoot = NodePath.resolve(
    process.env.KONTEXT_ENGINE_TARGET_DIR ||
      NodePath.join(process.env.RUNNER_TEMP || root, "kontext-target"),
  );
  const profile = process.env.KONTEXT_BUILD_PROFILE || "release";
  if (!["release", "dev"].includes(profile))
    throw new Error("KONTEXT_BUILD_PROFILE must be release or dev");
  const run = (program, args, capture = false) => {
    const result = NodeChildProcess.spawnSync(program, args, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      encoding: "utf8",
      env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} failed with status ${result.status}`);
    return result.stdout?.trim();
  };
  if (run("git", ["rev-parse", "HEAD"], true) !== source.revision) {
    throw new Error("Engine checkout does not match the pinned source revision");
  }
  const build = (triple) => {
    run("cargo", [
      "build",
      "--locked",
      "--manifest-path",
      NodePath.join(root, "Cargo.toml"),
      "--target-dir",
      buildRoot,
      "--target",
      triple,
      ...(profile === "release" ? ["--release"] : []),
    ]);
    return NodePath.join(
      buildRoot,
      triple,
      profile === "release" ? "release" : "debug",
      hostPlatform === "win" ? "kontext.exe" : "kontext",
    );
  };
  const binaries = triples.map(build);
  let binary = binaries[0];
  if (target === "mac-universal") {
    const directory = NodePath.join(buildRoot, target);
    NodeFS.mkdirSync(directory, { recursive: true });
    binary = NodePath.join(directory, "kontext");
    run("lipo", ["-create", ...binaries, "-output", binary]);
    run("lipo", [binary, "-verify_arch", "arm64", "x86_64"]);
  }
  // Cross-architecture builds are probed through the same pinned source compiled for the host.
  // Their bytes still receive their own target-bound digest; no foreign executable is launched.
  const hostTarget = `${hostPlatform}-${HostProcess.Architecture.defaultValue()}`;
  const probe =
    target === hostTarget || target === "mac-universal"
      ? binary
      : build(
          matrix[hostTarget]?.[0] ||
            (() => {
              throw new Error(`Unsupported probe host: ${hostTarget}`);
            })(),
        );
  const { probeKontext, KONTEXT_REQUIRED_OPERATIONS } =
    await import("../../../scripts/lib/kontext-resource.ts");
  await probeKontext(probe);
  const manifest = `${binary}.manifest.json`;
  NodeFS.writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        api_version: 1,
        sha256: NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(binary)).digest("hex"),
        target,
        source_revision: source.revision,
        capabilities: KONTEXT_REQUIRED_OPERATIONS,
      },
      null,
      2,
    )}\n`,
  );
  if (process.env.GITHUB_ENV) {
    NodeFS.appendFileSync(
      process.env.GITHUB_ENV,
      `T3CODE_KONTEXT_BIN=${binary}\nT3CODE_KONTEXT_MANIFEST=${manifest}\n`,
    );
  }
  console.log(`Built ${target} kontext from ${source.revision}: ${binary}`);
}
