import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpExceptionFilter } from "./http-exception.filter";

describe("HttpExceptionFilter", () => {
  it("hides internal error details in production", () => {
    const filter = new HttpExceptionFilter({
      get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
    } as ConfigService);

    let statusCode = 0;
    let body: Record<string, unknown> = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            statusCode = code;
            return {
              json(payload: Record<string, unknown>) {
                body = payload;
              },
            };
          },
        }),
        getRequest: () => ({ method: "GET", url: "/api/test" }),
      }),
    } as ArgumentsHost;

    filter.catch(new Error("database exploded"), host);

    assert.equal(statusCode, HttpStatus.INTERNAL_SERVER_ERROR);
    assert.equal(body.message, "Erro interno do servidor.");
    assert.equal(body.stack, undefined);
  });

  it("strips stack fields from http exceptions in production", () => {
    const filter = new HttpExceptionFilter({
      get: (key: string) => (key === "NODE_ENV" ? "production" : undefined),
    } as ConfigService);

    let body: Record<string, unknown> = {};
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status() {
            return {
              json(payload: Record<string, unknown>) {
                body = payload;
              },
            };
          },
        }),
        getRequest: () => ({ method: "GET", url: "/api/test" }),
      }),
    } as ArgumentsHost;

    filter.catch(
      new HttpException({ message: "fail", stack: "secret-stack" }, HttpStatus.BAD_REQUEST),
      host,
    );

    assert.equal(body.message, "fail");
    assert.equal(body.stack, undefined);
  });
});
