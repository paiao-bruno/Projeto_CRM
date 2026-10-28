import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BRAND, THEME, THEME_CSS_VARS, type ThemeToken } from "./brand";

describe("marca e tema centralizados", () => {
  const css = readFileSync(join(process.cwd(), "src/app/theme.css"), "utf8");

  it("theme.css declara cada token de THEME com o mesmo valor", () => {
    for (const token of Object.keys(THEME) as ThemeToken[]) {
      const declaration = new RegExp(`${THEME_CSS_VARS[token]}:\\s*${THEME[token]}\\s*;`, "i");
      assert.match(css, declaration, `token ${token} divergente em theme.css`);
    }
  });

  it("nao reutiliza o verde da referencia nem hexadecimais fora da paleta nos tokens", () => {
    assert.doesNotMatch(css, /#22c55e|#16a34a|#10b981|#34d399/i);
  });

  it("nome da marca vem de um unico lugar", () => {
    assert.equal(BRAND.name, "Vértice");
  });
});
