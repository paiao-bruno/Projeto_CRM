import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadGatewayException, HttpException } from "@nestjs/common";
import {
  buildInvalidSgpPayloadFailure,
  buildSgpSyncFailureDetails,
  extractHttpErrorCode,
  extractHttpErrorMessage,
  sanitizeStackTrace,
} from "./sgp-error.util";

describe("sgp-error.util", () => {
  it("extracts message from HttpException response object", () => {
    const error = new BadGatewayException({
      code: "SGP_UNEXPECTED_RESPONSE",
      message: "O SGP retornou uma resposta inesperada (HTTP 502).",
      context: { status: 502, endpoint: "/api/ura/titulos/" },
    });

    assert.equal(
      extractHttpErrorMessage(error),
      "O SGP retornou uma resposta inesperada (HTTP 502).",
    );
    assert.equal(extractHttpErrorCode(error), "SGP_UNEXPECTED_RESPONSE");
  });

  it("builds sync failure details from HttpException context", () => {
    const error = new HttpException(
      {
        code: "SGP_UNEXPECTED_RESPONSE",
        message: "O SGP retornou uma resposta inesperada (HTTP 500).",
        context: {
          stage: "invoices.page.12",
          entity: "invoice",
          endpoint: "/api/ura/titulos/",
          method: "POST",
          status: 500,
          contentType: "application/json",
          responseShape: { payloadType: "object", topLevelKeys: ["erro"] },
        },
      },
      502,
    );

    const details = buildSgpSyncFailureDetails(error, { stage: "invoices.page.12" });

    assert.equal(details.message, "O SGP retornou uma resposta inesperada (HTTP 500).");
    assert.equal(details.errorCode, "SGP_UNEXPECTED_RESPONSE");
    assert.equal(details.stage, "invoices.page.12");
    assert.equal(details.entity, "invoice");
    assert.equal(details.endpoint, "/api/ura/titulos/");
    assert.equal(details.httpStatus, 500);
    assert.equal(details.responseShape?.payloadType, "object");
  });

  it("builds invalid payload failure without leaking body contents", () => {
    const failure = buildInvalidSgpPayloadFailure({
      stage: "contracts.page.2",
      entity: "contract",
      endpoint: "/api/contrato/list/",
      httpStatus: 200,
      contentType: "text/html",
      body: "<html><body>token=abc app=secret</body></html>",
      offset: 100,
      limit: 50,
      technicalMessage: "Resposta SGP inválida.",
    });

    assert.equal(failure.errorCode, "SGP_INVALID_RESPONSE_SHAPE");
    assert.equal(failure.responseShape?.payloadType, "string");
    assert.equal(failure.responseShape?.textLength, 46);
    assert.doesNotMatch(JSON.stringify(failure), /abc/);
    assert.doesNotMatch(JSON.stringify(failure), /secret/);
  });

  it("sanitizes stack traces with credential-like fragments", () => {
    const sanitized = sanitizeStackTrace(
      "Error: failed\n    at request (token=abc123&app=foo)\n    at sync",
    );

    assert.match(sanitized ?? "", /token=\[REDACTED\]/);
    assert.doesNotMatch(sanitized ?? "", /abc123/);
  });

  it("builds failure details without leaking body, token or sensitive URL query", () => {
    const failure = buildSgpSyncFailureDetails(
      new BadGatewayException({
        code: "SGP_UNEXPECTED_RESPONSE",
        message: "O SGP retornou uma resposta inesperada (HTTP 502).",
        context: {
          endpoint: "/api/ura/titulos/",
          method: "POST",
          status: 502,
          contentType: "application/json",
          responseShape: {
            payloadType: "object",
            topLevelKeys: ["erro"],
            arrayKeys: {},
            detectedPaths: [],
            textLength: 0,
          },
        },
      }),
      { stage: "invoices.page.3", entity: "invoice" },
    );

    const serialized = JSON.stringify(failure);
    assert.match(failure.message, /HTTP 502/);
    assert.equal(failure.stage, "invoices.page.3");
    assert.doesNotMatch(serialized, /Bearer/);
    assert.doesNotMatch(serialized, /senha/);
    assert.doesNotMatch(serialized, /offset=/);
    assert.doesNotMatch(serialized, /"body"/);
  });
});
