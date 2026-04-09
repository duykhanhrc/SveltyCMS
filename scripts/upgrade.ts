/**
 * @file scripts/upgrade.ts
 * @description SveltyCMS Enhanced Upgrade CLI
 *
 * Automates the process of fetching updates, merging changes,
 * running codemods, and ensuring environment consistency.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";

// Configuration
const DEFAULT_BRANCH = "next";
const UPSTREAM_URL = "https://github.com/SveltyCMS/SveltyCMS.git";

interface UpgradeOptions {
  dryRun: boolean;
  skipTests: boolean;
  skipDb: boolean;
  force: boolean;
  branch: string;
}

const options: UpgradeOptions = {
  dryRun: process.argv.includes("--dry-run"),
  skipTests: process.argv.includes("--skip-tests"),
  skipDb: process.argv.includes("--skip-db"),
  force: process.argv.includes("--force"),
  branch: process.argv.find((arg) => arg.startsWith("--branch="))?.split("=")[1] || DEFAULT_BRANCH,
};

async function runCommand(
  command: string,
  args: string[],
  options: { silent?: boolean; capture?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: options.silent ? "ignore" : options.capture ? "pipe" : "inherit",
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    if (options.capture && proc.stdout && proc.stderr) {
      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));
    }

    proc.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function isGitDirty(): Promise<boolean> {
  const { stdout } = await runCommand("git", ["status", "--porcelain"], {
    capture: true,
    silent: true,
  });
  return stdout.trim().length > 0;
}

async function ensureRemote(): Promise<string> {
  const { stdout } = await runCommand("git", ["remote", "-v"], {
    capture: true,
    silent: true,
  });
  if (stdout.includes(UPSTREAM_URL)) {
    const lines = stdout.split("\n");
    const upstreamLine = lines.find((line) => line.includes(UPSTREAM_URL));
    return upstreamLine?.split("\t")[0] || "origin";
  }

  console.log(pc.blue("Adding upstream remote..."));
  await runCommand("git", ["remote", "add", "upstream", UPSTREAM_URL]);
  return "upstream";
}

async function runCodemods() {
  const codemodsDir = join(process.cwd(), "scripts", "codemods");
  if (!existsSync(codemodsDir)) return;

  const files = readdirSync(codemodsDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
  if (files.length === 0) return;

  console.log(pc.magenta("\nRunning codemods..."));
  for (const file of files) {
    console.log(pc.cyan(`  Executing ${file}...`));
    if (!options.dryRun) {
      await runCommand("bun", [join(codemodsDir, file)]);
    }
  }
}

async function main() {
  console.log(pc.bold(pc.blue("\n🚀 SveltyCMS Upgrade Tool")));
  console.log(pc.dim("---------------------------------------"));

  if (options.dryRun) {
    console.log(pc.yellow("⚠️  DRY RUN MODE ENABLED - No changes will be committed\n"));
  }

  // 1. Git Check
  if (!existsSync(join(process.cwd(), ".git"))) {
    console.error(pc.red("❌ Error: Not a git repository."));
    process.exit(1);
  }

  if ((await isGitDirty()) && !options.force) {
    console.error(
      pc.red("❌ Error: You have uncommitted changes. Please commit or stash them first."),
    );
    console.log(pc.dim("Use --force to ignore (not recommended)."));
    process.exit(1);
  }

  // 2. Remote Check
  const remote = await ensureRemote();

  // 3. Fetch
  console.log(pc.blue(`\nFetching updates from ${remote}/${options.branch}...`));
  await runCommand("git", ["fetch", remote, options.branch]);

  // 4. Merge
  console.log(pc.blue(`Merging changes...`));
  if (options.dryRun) {
    console.log(
      pc.yellow(`[Dry Run] Would run: git merge ${remote}/${options.branch} --no-ff --no-commit`),
    );
  } else {
    const mergeResult = await runCommand("git", [
      "merge",
      `${remote}/${options.branch}`,
      "--no-ff",
      "--no-commit",
    ]);
    if (mergeResult.code !== 0) {
      console.warn(pc.yellow("\n⚠️  Conflicts detected! Please resolve them manually, then:"));
      console.log(pc.cyan("  1. Resolve conflicts in your IDE"));
      console.log(pc.cyan("  2. git add ."));
      console.log(pc.cyan("  3. bun install"));
      console.log(pc.cyan("  4. bun run scripts/upgrade.ts --skip-merge (to continue)"));
      process.exit(1);
    }
  }

  // 5. Install dependencies
  console.log(pc.blue("\nUpdating dependencies..."));
  if (options.dryRun) {
    console.log(pc.yellow("[Dry Run] Would run: bun install"));
  } else {
    await runCommand("bun", ["install"]);
  }

  // 6. Codemods
  await runCodemods();

  // 7. Database Migration
  if (!options.skipDb) {
    console.log(pc.blue("\nChecking database migrations..."));
    if (options.dryRun) {
      console.log(pc.yellow("[Dry Run] Would run: bun run db:push"));
    } else {
      await runCommand("bun", ["run", "db:push"]);
    }
  }

  // 8. Run Tests
  if (!options.skipTests) {
    console.log(pc.blue("\nRunning unit tests..."));
    if (options.dryRun) {
      console.log(pc.yellow("[Dry Run] Would run: bun run test:unit"));
    } else {
      const testResult = await runCommand("bun", ["run", "test:unit"]);
      if (testResult.code !== 0) {
        console.error(pc.red("\n❌ Tests failed! Please check the output above."));
      }
    }
  }

  console.log(pc.dim("\n---------------------------------------"));
  if (options.dryRun) {
    console.log(pc.green("✅ Dry run complete! No changes were made."));
  } else {
    console.log(pc.green("✅ Upgrade complete! Review your changes and commit."));
    console.log(pc.dim("If something went wrong, you can undo with: git merge --abort"));
  }
}

main().catch((err) => {
  console.error(pc.red("\nUnexpected error during upgrade:"), err);
  process.exit(1);
});
