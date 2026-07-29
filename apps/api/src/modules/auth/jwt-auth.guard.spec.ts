import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../../security/decorators/public.decorator";

describe("JwtAuthGuard", () => {
  it("allows public routes without authentication", () => {
    const reflector = {
      getAllAndOverride: (key: string) => key === IS_PUBLIC_KEY,
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;

    assert.equal(guard.canActivate(context), true);
  });

  it("rejects missing user with unauthorized", () => {
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    assert.throws(
      () => guard.handleRequest(null, null, null),
      UnauthorizedException,
    );
  });
});
