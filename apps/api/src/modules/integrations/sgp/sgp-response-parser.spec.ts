import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyMayContainEntityPayload,
  describeSgpPayload,
  extractSgpEntityRecords,
  isValidEmptySgpPage,
  looksLikeContract,
  looksLikeTitle,
  summarizeSgpResponseStructure,
  validateSgpListResponse,
} from "./sgp-response-parser";

const sampleContract = { id: "c1", cliente_id: "1", status: "ATIVO", plano: "600 Mega" };
const sampleInvoice = { id: "t1", cliente_id: "1", contrato: "c1", valor: "99,90", status: "ABERTO" };
const sampleCustomer = { id: "1", nome: "Cliente A", cpfcnpj: "111" };

describe("sgp-response-parser", () => {
  describe("extractSgpEntityRecords contracts", () => {
    it("extracts flat contratos payload", () => {
      const records = extractSgpEntityRecords({ contratos: [sampleContract] }, "contract");
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "c1");
    });

    it("extracts nested data.contratos payload", () => {
      const records = extractSgpEntityRecords({ data: { contratos: [sampleContract] } }, "contract");
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "c1");
    });

    it("extracts dados.contratos payload", () => {
      const records = extractSgpEntityRecords({ dados: { contratos: [sampleContract] } }, "contract");
      assert.equal(records.length, 1);
    });

    it("extracts result.contratos payload", () => {
      const records = extractSgpEntityRecords({ result: { contratos: [sampleContract] } }, "contract");
      assert.equal(records.length, 1);
    });

    it("extracts results array payload", () => {
      const records = extractSgpEntityRecords({ results: [sampleContract] }, "contract");
      assert.equal(records.length, 1);
    });

    it("extracts deeply nested response.data.contratos payload", () => {
      const records = extractSgpEntityRecords(
        { response: { data: { contratos: [sampleContract] } } },
        "contract",
      );
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "c1");
    });

    it("extracts direct array payload", () => {
      const records = extractSgpEntityRecords([sampleContract], "contract");
      assert.equal(records.length, 1);
    });

    it("extracts data array payload", () => {
      const records = extractSgpEntityRecords({ data: [sampleContract] }, "contract");
      assert.equal(records.length, 1);
    });

    it("returns empty for null, empty and invalid payloads", () => {
      assert.deepEqual(extractSgpEntityRecords(null, "contract"), []);
      assert.deepEqual(extractSgpEntityRecords(undefined, "contract"), []);
      assert.deepEqual(extractSgpEntityRecords({}, "contract"), []);
      assert.deepEqual(extractSgpEntityRecords("", "contract"), []);
      assert.deepEqual(extractSgpEntityRecords({ contratos: [] }, "contract"), []);
    });

    it("does not treat wrapper object as contract", () => {
      const records = extractSgpEntityRecords({ data: { contratos: [sampleContract] } }, "contract");
      assert.equal(records.some((record) => Array.isArray(record.contratos)), false);
      assert.equal(looksLikeContract({ contratos: [sampleContract] }), false);
    });

    it("ignores pagination-only wrapper", () => {
      const records = extractSgpEntityRecords(
        { offset: 0, limit: 10, total: 100, next: true },
        "contract",
      );
      assert.deepEqual(records, []);
    });

    it("extracts records when pagination metadata is alongside entity list", () => {
      const records = extractSgpEntityRecords(
        {
          data: {
            contratos: [sampleContract],
            total: 1,
            offset: 0,
            limit: 10,
          },
        },
        "contract",
      );
      assert.equal(records.length, 1);
    });

    it("fixes previous zero-record nested scenario", () => {
      const records = extractSgpEntityRecords(
        { status: 1, data: { contratos: [{ id: "c1", cliente_id: "1" }] } },
        "contract",
      );
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "c1");
    });
  });

  describe("extractSgpEntityRecords invoices", () => {
    it("extracts flat titulos payload", () => {
      const records = extractSgpEntityRecords({ titulos: [sampleInvoice] }, "invoice");
      assert.equal(records.length, 1);
    });

    it("extracts faturas payload", () => {
      const records = extractSgpEntityRecords(
        { data: { faturas: [{ id: "f1", valor: "10,00", cliente_id: "1" }] } },
        "invoice",
      );
      assert.equal(records.length, 1);
      assert.equal(looksLikeTitle(records[0]!), true);
    });

    it("extracts nested data.titulos payload", () => {
      const records = extractSgpEntityRecords({ data: { titulos: [sampleInvoice] } }, "invoice");
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, "t1");
    });
  });

  describe("extractSgpEntityRecords customers", () => {
    it("extracts flat clientes payload", () => {
      const records = extractSgpEntityRecords({ clientes: [sampleCustomer] }, "customer");
      assert.equal(records.length, 1);
    });

    it("extracts nested data.clientes payload", () => {
      const records = extractSgpEntityRecords({ data: { clientes: [sampleCustomer] } }, "customer");
      assert.equal(records.length, 1);
    });

    it("extracts dados.clientes payload", () => {
      const records = extractSgpEntityRecords({ dados: { clientes: [sampleCustomer] } }, "customer");
      assert.equal(records.length, 1);
    });
  });

  describe("validateSgpListResponse", () => {
    it("accepts direct array payloads", () => {
      const result = validateSgpListResponse([sampleCustomer], "customer");
      assert.equal(result.ok, true);
      assert.equal(result.records.length, 1);
    });

    it("accepts wrapper data payloads", () => {
      const result = validateSgpListResponse({ data: [sampleCustomer] }, "customer");
      assert.equal(result.ok, true);
    });

    it("accepts wrapper dados payloads", () => {
      const result = validateSgpListResponse({ dados: { clientes: [sampleCustomer] } }, "customer");
      assert.equal(result.ok, true);
    });

    it("accepts wrapper result/results payloads", () => {
      assert.equal(validateSgpListResponse({ result: [sampleCustomer] }, "customer").ok, true);
      assert.equal(validateSgpListResponse({ results: [sampleCustomer] }, "customer").ok, true);
    });

    it("accepts wrapper clientes payloads", () => {
      const result = validateSgpListResponse({ clientes: [sampleCustomer] }, "customer");
      assert.equal(result.ok, true);
    });

    it("accepts valid empty pages", () => {
      assert.equal(validateSgpListResponse([], "customer").ok, true);
      assert.equal(validateSgpListResponse({ clientes: [] }, "customer").ok, true);
      assert.equal(
        validateSgpListResponse({ offset: 100, limit: 50, total: 100 }, "customer").ok,
        true,
      );
      assert.equal(isValidEmptySgpPage(null, "customer"), true);
    });

    it("rejects unexpected null payloads", () => {
      const result = validateSgpListResponse({ clientes: null, foo: "bar" }, "customer");
      assert.equal(result.ok, false);
      assert.match(result.technicalMessage ?? "", /sem registros reconhecíveis/);
    });

    it("rejects unexpected HTML/text payloads", () => {
      const result = validateSgpListResponse("<html>token=abc</html>", "invoice");
      assert.equal(result.ok, false);
      assert.equal(result.shape.payloadType, "string");
      assert.doesNotMatch(JSON.stringify(result), /abc/);
    });

    it("rejects objects with unknown keys and no entity list", () => {
      const result = validateSgpListResponse({ foo: "bar", baz: 1 }, "contract");
      assert.equal(result.ok, false);
      assert.deepEqual(result.shape.topLevelKeys, ["foo", "baz"]);
    });

    it("rejects unknown HTTP 200 object payloads without treating them as success", () => {
      const result = validateSgpListResponse(
        { status: 1, message: "ok", payload: { nested: true } },
        "invoice",
      );
      assert.equal(result.ok, false);
      assert.equal(result.empty, false);
      assert.match(result.technicalMessage ?? "", /sem registros reconhecíveis/);
    });
  });

  describe("structure helpers", () => {
    it("detects when body may contain entities but parser returns none for unrelated shape", () => {
      assert.equal(bodyMayContainEntityPayload({ data: { contratos: [sampleContract] } }, "contract"), true);
      assert.equal(bodyMayContainEntityPayload({}, "contract"), false);
    });

    it("summarizes structural information without leaking payload values", () => {
      const summary = summarizeSgpResponseStructure({
        data: { contratos: [sampleContract], total: 1 },
      });
      assert.equal(summary.payloadType, "object");
      assert.ok(summary.detectedPaths.some((path) => path.startsWith("contract:")));
      assert.equal(describeSgpPayload([sampleContract]).payloadType, "array");
    });
  });
});
