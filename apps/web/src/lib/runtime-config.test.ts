import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWebOnlyMode,
  resolveApiBaseUrl,
  isLegacyApiRoute,
} from "./runtime-config";

describe("runtime-config", () => {
  it("detects web-only mode from env", () => {
    assert.equal(isWebOnlyMode({ NEXT_PUBLIC_WEB_ONLY_MODE: "true" }), true);
    assert.equal(isWebOnlyMode({ NEXT_PUBLIC_WEB_ONLY_MODE: "false" }), false);
  });

  it("resolves API base URL for web-only and legacy modes", () => {
    assert.equal(
      resolveApiBaseUrl({
        NEXT_PUBLIC_WEB_ONLY_MODE: "true",
        NEXT_PUBLIC_API_URL: "http://localhost:4000/api",
      }),
      "/api",
    );
    assert.equal(
      resolveApiBaseUrl({ NEXT_PUBLIC_API_URL: "http://localhost:4000/api" }),
      "http://localhost:4000/api",
    );
    assert.equal(
      resolveApiBaseUrl({ NEXT_PUBLIC_WEB_ONLY_MODE: "true" }),
      "/api",
    );
  });

  it("identifies legacy API routes", () => {
    assert.equal(isLegacyApiRoute("/customers"), true);
    assert.equal(isLegacyApiRoute("/sales-funnel"), false);
  });
});
