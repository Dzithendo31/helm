#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./http";
import { UiSession } from "./session";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const argv = process.argv.slice(2);
const arg = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
};

const port = Number(arg("--port") ?? process.env.HELM_PORT ?? 4500);
const runnerKind: "mock" | "cli" = argv.includes("--cli") ? "cli" : "mock";
const model = arg("--model");

const session = new UiSession({
  runnerKind,
  rolesDir: process.env.HELM_ROLES_DIR ?? join(ROOT, "roles"),
  baseDir: ROOT,
  ...(model ? { model } : {}),
});

startServer({ port, webDir: join(ROOT, "web"), session });
process.stdout.write(`  runner   →  ${runnerKind}${model ? ` (${model})` : ""}\n`);
