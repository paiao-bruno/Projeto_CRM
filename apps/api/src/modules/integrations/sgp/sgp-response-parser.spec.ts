import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bodyMayContainEntityPayload,
  extractSgpEntityRecords,
  looksLikeContract,
  looksLikeTitle,
  summarizeSgpResponseStructure,
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

    it("extracts result.contratos payload", () => {
      const records = extractSgpEntityRecords({ result: { contratos: [sampleContract] } }, "contract");
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
      assert.equal(summary.type, "object");
      assert.ok(summary.detectedPaths.some((path) => path.startsWith("contract:")));
    });
  });
});
