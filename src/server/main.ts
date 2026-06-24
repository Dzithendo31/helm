#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
// Real by default: cli agents building real files. --mock only for development.
const runnerKind: "mock" | "cli" = argv.includes("--mock") ? "mock" : "cli";
const model = arg("--model");
const workspace =
  runnerKind === "cli" ? resolve(arg("--workspace") ?? join(ROOT, "..", "helm-build")) : undefined;

if (workspace) mkdirSync(workspace, { recursive: true });

const session = new UiSession({
  runnerKind,
  rolesDir: process.env.HELM_ROLES_DIR ?? join(ROOT, "roles"),
  baseDir: ROOT,
  ...(model ? { model } : {}),
  ...(workspace ? { workspace } : {}),
});

startServer({ port, webDir: join(ROOT, "web"), session });
process.stdout.write(`  runner   →  ${runnerKind}${model ? ` (${model})` : ""}\n`);
if (workspace) process.stdout.write(`  build    →  ${workspace}\n`);
