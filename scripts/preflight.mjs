#!/usr/bin/env node
/**
 * Valida ambiente antes de iniciar o Funil (web-only).
 * Compatível com Windows (PowerShell/CMD) e Linux/macOS.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..");

const MIN_NODE_MAJOR = 20;
const REQUIRED_SCRIPT = "dev:web:funnel";
const REQUIRED_BRANCH_HINT = "cursor/homologation-fixes-edc0";

function fail(message, hints = []) {
  console.error(`\n[preflight] ERRO: ${message}`);
  for (const hint of hints) {
    console.error(`  → ${hint}`);
  }
  process.exit(1);
}

function readRootPackage() {
  const packagePath = join(REPO_ROOT, "package.json");
  if (!existsSync(packagePath)) {
    fail(
      `package.json não encontrado em ${REPO_ROOT}.`,
      [
        "Execute os comandos na RAIZ do repositório (pasta que contém apps\\web e apps\\api).",
        "No PowerShell: Set-Location -LiteralPath \"C:\\Users\\User\\Desktop\\CRM\\Projeto_CRM\\Projeto_CRM-cursor-isp-crm-architecture-edc0\"",
        "Confirme com: Test-Path .\\package.json",
      ],
    );
  }
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    fail(
      `Node.js ${process.versions.node} detectado; mínimo exigido: ${MIN_NODE_MAJOR}.x`,
      ["Instale Node.js LTS 20+ em https://nodejs.org/", "Confirme com: node -v"],
    );
  }
}

function checkRequiredScript(pkg) {
  if (!pkg.scripts?.[REQUIRED_SCRIPT]) {
    fail(
      `Script "${REQUIRED_SCRIPT}" ausente no package.json da raiz.`,
      [
        "Seu clone parece estar em branch antiga (ex.: cursor/isp-crm-architecture-edc0).",
        `Atualize para a branch ${REQUIRED_BRANCH_HINT}:`,
        "  git fetch origin",
        `  git checkout ${REQUIRED_BRANCH_HINT}`,
        "  git pull",
        "Depois: npm install",
      ],
    );
  }
}

function checkWorkspaces(pkg) {
  const expected = ["apps/web", "apps/api"];
  for (const workspace of expected) {
    if (!existsSync(join(REPO_ROOT, workspace, "package.json"))) {
      fail(`Workspace ausente: ${workspace}`, ["Verifique se o clone está completo."]);
    }
  }
}

function checkNodeModules() {
  if (!existsSync(join(REPO_ROOT, "node_modules"))) {
    fail("Dependências não instaladas (node_modules ausente).", [
      "Na raiz do repositório execute: npm install",
    ]);
  }
}

async function checkDatabaseOptional() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail("DATABASE_URL inválida.", ["Revise .env ou .env.example"]);
  }

  const host = parsed.hostname || "localhost";
  const port = Number(parsed.port || 5432);

  const reachable = await new Promise((resolveReach) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1500);
    socket.on("connect", () => {
      socket.end();
      resolveReach(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolveReach(false);
    });
    socket.on("error", () => resolveReach(false));
  });

  if (!reachable) {
    console.warn(
      "[preflight] AVISO: PostgreSQL não responde em " +
        `${host}:${port}. O script ensure-db tentará subir via Docker.`,
    );
    console.warn(
      "[preflight] Se Docker não estiver disponível, inicie o banco manualmente:",
    );
    console.warn("[preflight]   docker compose up -d postgres");
  } else {
    console.log(`[preflight] PostgreSQL acessível em ${host}:${port}.`);
  }
}

export async function runPreflight(options = {}) {
  if (process.cwd() !== REPO_ROOT) {
    console.warn(
      `[preflight] AVISO: cwd=${process.cwd()} difere da raiz=${REPO_ROOT}.`,
    );
    console.warn("[preflight] Os scripts npm devem ser executados na raiz do repositório.");
  }

  const pkg = readRootPackage();
  checkNodeVersion();
  checkRequiredScript(pkg);
  checkWorkspaces(pkg);

  if (!options.skipNodeModules) {
    checkNodeModules();
  }

  if (!options.skipDatabase) {
    await checkDatabaseOptional();
  }

  console.log("[preflight] Ambiente OK para dev:web:funnel.");
  return { repoRoot: REPO_ROOT, packageName: pkg.name };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPreflight().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
