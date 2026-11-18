import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SALES_FUNNEL_STAGE_CODES, SALES_FUNNEL_STAGES } from "./sales-funnel.constants";
import {
  SALES_FUNNEL_STAGE_FILL,
  salesFunnelStageSurface,
} from "./sales-funnel-stage-surfaces";

function srgbChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = srgbChannel((n >> 16) & 255);
  const g = srgbChannel((n >> 8) & 255);
  const b = srgbChannel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const [hi, lo] = first > second ? [first, second] : [second, first];
  return (hi + 0.05) / (lo + 0.05);
}

describe("superfícies visuais das etapas do funil", () => {
  it("associa cada código estável ao hexadecimal pedido", () => {
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.PROSPECCAO], "#DC2626");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.VIABILIDADE], "#F87171");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.NEGOCIACAO], "#EAB308");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.CONTRATO], "#FDE68A");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.AGENDAMENTO], "#86EFAC");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.ATIVACAO], "#16A34A");
    assert.equal(SALES_FUNNEL_STAGE_FILL[SALES_FUNNEL_STAGE_CODES.SUCESSO], "#6366F1");
  });

  it("resolve pelo código, não pela posição nem pelo nome", () => {
    const reversed = [...SALES_FUNNEL_STAGES].reverse();
    for (const stage of reversed) {
      const surface = salesFunnelStageSurface(stage.code);
      assert.ok(surface);
      assert.equal(surface.fill, SALES_FUNNEL_STAGE_FILL[stage.code]);
    }
    assert.equal(salesFunnelStageSurface("Prospecção"), null);
    assert.equal(salesFunnelStageSurface("QUALIFICACAO"), null);
    assert.equal(salesFunnelStageSurface(null), null);
  });

  it("mantém contraste mínimo de 4,5:1 entre preenchimento e texto", () => {
    for (const stage of SALES_FUNNEL_STAGES) {
      const surface = salesFunnelStageSurface(stage.code);
      assert.ok(surface);
      assert.ok(
        contrastRatio(surface.fill, surface.text) >= 4.5,
        `${stage.code} ${surface.fill} / ${surface.text}`,
      );
    }
  });
});
