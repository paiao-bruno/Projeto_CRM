import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  originNameKey,
  normalizeOriginName,
  DEFAULT_SALE_ORIGINS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  AD_CHANNELS,
} from "./campaigns";

describe("origens de venda", () => {
  it("normaliza caixa e espaços equivalentes", () => {
    assert.equal(originNameKey("  Site  "), originNameKey("site"));
    assert.equal(originNameKey("Google   Ads"), originNameKey("google ads"));
    assert.equal(normalizeOriginName("  Indicação  "), "Indicação");
  });

  it("rotula todos os estados de campanha sem restringir a envio", () => {
    assert.equal(CAMPAIGN_STATUSES.length, 7);
    for (const status of CAMPAIGN_STATUSES) {
      assert.ok(CAMPAIGN_STATUS_LABELS[status]);
    }
    assert.equal(AD_CHANNELS.length, 6);
  });

  it("inclui as sete origens padrão", () => {
    assert.deepEqual([...DEFAULT_SALE_ORIGINS], [
      "Indicação",
      "Site",
      "Instagram",
      "Facebook",
      "Google",
      "Prospecção ativa",
      "Cliente antigo",
    ]);
  });
});
