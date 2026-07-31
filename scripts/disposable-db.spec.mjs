#!/usr/bin/env node
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDisposableDatabase,
  DEFAULT_E2E_DATABASE_URL,
} from "./lib/disposable-db.mjs";

describe("disposable-db guards", () => {
  it("recusa banco isp_crm sem flag", () => {
    assert.throws(
      () =>
        assertDisposableDatabase("postgresql://crm:crm@localhost:5432/isp_crm?schema=public", {
          requireFlag: true,
        }),
      /ALLOW_DISPOSABLE_DB=true/,
    );
  });

  it("recusa banco isp_crm mesmo com flag", () => {
    assert.throws(
      () =>
        assertDisposableDatabase("postgresql://crm:crm@localhost:5432/isp_crm?schema=public", {
          requireFlag: false,
        }),
      /não é exclusivo para teste/,
    );
  });

  it("aceita banco e2e local com flag", () => {
    const target = assertDisposableDatabase(DEFAULT_E2E_DATABASE_URL, {
      requireFlag: false,
    });
    assert.equal(target.database, "isp_crm_web_e2e");
  });

  it("recusa host remoto", () => {
    assert.throws(
      () =>
        assertDisposableDatabase(
          "postgresql://crm:crm@db.example.com:5432/isp_crm_web_e2e?schema=public",
          { requireFlag: false },
        ),
      /não é local/,
    );
  });
});
