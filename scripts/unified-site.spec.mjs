import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "apps/web/src");

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|css)$/.test(entry) && !/\.(test|integration)\.ts$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = walk(src);
const read = (path) => readFileSync(path, "utf8");

describe("site único (verificação estática)", () => {
  it("existe um único layout autenticado e nenhum grupo de rotas paralelo", () => {
    assert.ok(existsSync(join(src, "app/(app)/layout.tsx")));
    assert.ok(!existsSync(join(src, "app/(vertice)")), "grupo (vertice) removido");
    assert.ok(!existsSync(join(src, "components/vertice")), "shell paralelo removido");
    assert.ok(existsSync(join(src, "app/(app)/inbox/page.tsx")), "inbox dentro do layout único");
    assert.ok(!existsSync(join(src, "app/(app)/chat")), "chat legado consolidado na inbox");
  });

  it("a rota /chat redireciona para /inbox", () => {
    assert.match(read(join(root, "apps/web/next.config.ts")), /source:\s*"\/chat"[^}]*destination:\s*"\/inbox"/);
  });

  it("nenhum arquivo do web depende do NestJS, da porta 4000, do modo web-only ou de iframe", () => {
    const forbidden = /localhost:4000|NEXT_PUBLIC_API_URL|NEXT_PUBLIC_WEB_ONLY_MODE|isWebOnlyMode|apps\/api|NestJS|<iframe|API desativada|Voltar aos módulos/i;
    const offenders = files.filter((file) => forbidden.test(read(file))).map((file) => relative(root, file));
    assert.deepEqual(offenders, []);
  });

  it("SGP só aparece como aviso de descontinuação na tela de Integrações", () => {
    const offenders = files
      .filter((file) => /\bSGP\b/i.test(read(file)))
      .map((file) => relative(root, file))
      .filter((file) => file !== "apps/web/src/app/(app)/integrations/page.tsx");
    assert.deepEqual(offenders, []);
  });

  it("todo item do menu aponta para uma página existente", async () => {
    const { ALL_NAV_ITEMS } = await import("../apps/web/src/lib/feature-flags.ts").catch(() => ({ ALL_NAV_ITEMS: null }));
    const source = read(join(src, "lib/feature-flags.ts"));
    const hrefs = [...source.matchAll(/href: "(\/[a-z-]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 8);
    for (const href of hrefs) assert.ok(existsSync(join(src, "app/(app)", href, "page.tsx")), `página ausente: ${href}`);
    void ALL_NAV_ITEMS;
  });

  it("tema único: um conjunto de variáveis no :root e nenhum fundo escuro fixo", () => {
    const globals = read(join(src, "app/globals.css"));
    assert.match(globals, /@import "\.\/theme\.css"/);
    assert.doesNotMatch(globals, /#07111f|radial-gradient/i);
  });
});
