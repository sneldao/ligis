import release from "../starter-version.json" with { type: "json" };

export { release };

export class ConformanceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function checkEnvironment() {
  if (process.versions.node.split(".")[0] !== "24" || !["darwin", "linux"].includes(process.platform)) {
    throw new ConformanceError("Use Node.js 24 on macOS or Linux (Windows: use WSL2)", "environment_invalid");
  }
}

export async function reportConformance(run) {
  const started = performance.now();
  let result;
  try {
    checkEnvironment();
    result = await run();
  } catch (error) {
    result = error instanceof ConformanceError
      ? { status: "failed", code: error.code, message: error.message }
      : { status: "failed", code: "local_check_failed", message: "Local checks could not complete; check files and build diagnostics" };
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify({ reportVersion: 1, starterVersion: release.version,
    protocolVersion: release.protocolVersion, toolchain: { node: process.versions.node, platform: process.platform, arch: process.arch },
    durationMs: Math.round(performance.now() - started), ...result })}\n`);
}
