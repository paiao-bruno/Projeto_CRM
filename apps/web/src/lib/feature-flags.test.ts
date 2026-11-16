import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_NAV_ITEMS, buildNavItems, defaultLandingPath, isFeatureEnabled, isMockRouteEnabled } from "./feature-flags";

describe("feature-flags", () => {
  it("disables mock modules by default in production", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_ENABLE_CAMPAIGNS: undefined,
      NEXT_PUBLIC_ENABLE_FLOWS: undefined,
      NEXT_PUBLIC_ENABLE_SCHEDULE: undefined,
      NEXT_PUBLIC_ENABLE_TEAM_CHAT: undefined,
    };

    const nav = buildNavItems(env);
    const hrefs = nav.map((item) => item.href);

    assert.ok(hrefs.includes("/dashboard"));
    assert.ok(hrefs.includes("/customers"));
    assert.ok(!hrefs.includes("/campaigns"));
    assert.ok(!hrefs.includes("/flows"));
    assert.ok(!hrefs.includes("/schedule"));
    assert.ok(!hrefs.includes("/team-chat"));
  });

  it("shows mock modules only when explicitly enabled", () => {
    const env = {
      NODE_ENV: "development",
      NEXT_PUBLIC_ENABLE_CAMPAIGNS: "true",
      NEXT_PUBLIC_ENABLE_FLOWS: "true",
      NEXT_PUBLIC_ENABLE_SCHEDULE: "true",
      NEXT_PUBLIC_ENABLE_TEAM_CHAT: "true",
    };

    const nav = buildNavItems(env);
    const hrefs = nav.map((item) => item.href);

    assert.ok(hrefs.includes("/campaigns"));
    assert.ok(hrefs.includes("/flows"));
    assert.ok(hrefs.includes("/schedule"));
    assert.ok(hrefs.includes("/team-chat"));
  });

  it("keeps stable modules visible regardless of mock flags", () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_ENABLE_CAMPAIGNS: "false",
      NEXT_PUBLIC_ENABLE_FLOWS: "false",
      NEXT_PUBLIC_ENABLE_SCHEDULE: "false",
      NEXT_PUBLIC_ENABLE_TEAM_CHAT: "false",
    };

    const nav = buildNavItems(env);
    const hrefs = nav.map((item) => item.href);

    for (const required of ["/dashboard", "/integrations", "/inbox", "/sales-funnel", "/customers", "/contracts", "/invoices", "/ai-agents"]) {
      assert.ok(hrefs.includes(required), `missing ${required}`);
    }
  });

  it("blocks mock routes unless enabled via env", () => {
    const disabledEnv = {
      NEXT_PUBLIC_ENABLE_CAMPAIGNS: "false",
    };

    assert.equal(isMockRouteEnabled("/campaigns", disabledEnv), false);
    assert.equal(isMockRouteEnabled("/customers", disabledEnv), true);

    const enabledEnv = {
      NEXT_PUBLIC_ENABLE_CAMPAIGNS: "true",
    };

    assert.equal(isFeatureEnabled("campaigns", enabledEnv), true);
    assert.equal(isMockRouteEnabled("/campaigns", enabledEnv), true);
  });

  it("declares all mock nav entries with feature keys", () => {
    const mockItems = ALL_NAV_ITEMS.filter((item) =>
      ["/campaigns", "/flows", "/schedule"].includes(item.href),
    );
    assert.equal(mockItems.every((item) => Boolean(item.feature)), true);
  });

  it("menu único: não existe mais /chat e itens seguem as permissões", () => {
    const all = ALL_NAV_ITEMS.map((item) => item.href);
    assert.ok(!all.includes("/chat"));
    const agent = buildNavItems({}, ["chat.read", "chat.reply"]).map((item) => item.href);
    assert.deepEqual(agent, ["/inbox", "/boards"]);
    const admin = buildNavItems({}, ["dashboard.read", "chat.read", "customers.manage", "sales_funnel.read", "ai_agents.manage", "crm.manage"]).map((item) => item.href);
    assert.deepEqual(admin, ["/dashboard", "/inbox", "/sales-funnel", "/customers", "/contracts", "/invoices", "/ai-agents", "/integrations", "/boards"]);
  });

  it("destino padrão após login respeita permissões", () => {
    assert.equal(defaultLandingPath(["dashboard.read", "chat.read"]), "/dashboard");
    assert.equal(defaultLandingPath(["chat.read"]), "/inbox");
    assert.equal(defaultLandingPath(["sales_funnel.read"]), "/sales-funnel");
    assert.equal(defaultLandingPath([]), "/inbox");
  });
});
