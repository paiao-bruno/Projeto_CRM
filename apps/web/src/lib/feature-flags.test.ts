import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_NAV_ITEMS, buildNavItems, isFeatureEnabled, isMockRouteEnabled } from "./feature-flags";

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
    assert.equal(nav.find((item) => item.href === "/chat")?.children?.length ?? 0, 0);
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
    assert.equal(nav.find((item) => item.href === "/chat")?.children?.length, 1);
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
    const hrefs = nav.flatMap((item) => [item.href, ...(item.children?.map((child) => child.href) ?? [])]);

    for (const required of ["/dashboard", "/integrations", "/chat", "/sales-funnel", "/customers", "/contracts", "/invoices", "/ai-agents"]) {
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
});
