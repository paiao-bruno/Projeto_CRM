import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, it } from "node:test";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { PermissionsGuard } from "../guards/permissions.guard";

describe("PermissionsGuard", () => {
  it("allows requests without required permissions metadata", () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: [] } }),
      }),
    } as never;

    assert.equal(guard.canActivate(context), true);
  });

  it("blocks requests when required permission is missing", () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === PERMISSIONS_KEY ? ["integrations.manage"] : undefined,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: { permissions: ["dashboard.read"] } }),
      }),
    } as never;

    assert.throws(() => guard.canActivate(context), ForbiddenException);
  });

  it("allows requests when all required permissions are granted", () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === PERMISSIONS_KEY ? ["dashboard.read", "integrations.manage"] : undefined,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { permissions: ["dashboard.read", "integrations.manage"] },
        }),
      }),
    } as never;

    assert.equal(guard.canActivate(context), true);
  });

  it("blocks unauthenticated requests when permissions are required", () => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === PERMISSIONS_KEY ? ["integrations.manage"] : undefined,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as never;

    assert.throws(() => guard.canActivate(context), ForbiddenException);
  });
});
