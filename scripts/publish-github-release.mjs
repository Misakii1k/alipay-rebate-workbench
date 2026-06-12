import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";

const DEFAULT_USERNAME = "Misakii1k";

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

function resolveGithubToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  const username = process.env.GH_USERNAME || DEFAULT_USERNAME;
  const input = `protocol=https\nhost=github.com\nusername=${username}\n`;
  const result = spawnSync("git", ["credential", "fill"], {
    input,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "Unable to read GitHub credentials from Git Credential Manager.");
  }

  const values = Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );

  if (!values.password) {
    throw new Error("GitHub token was not found. Please login with `git credential-manager github login --browser` first.");
  }

  return values.password;
}

async function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const ghToken = resolveGithubToken();

  console.log("Building desktop app...");
  await run(npmCommand, ["run", "build"]);

  console.log("Publishing GitHub release artifacts...");
  await run(
    npxCommand,
    ["electron-builder", "--win", "nsis", "--publish", "always"],
    { GH_TOKEN: ghToken }
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
