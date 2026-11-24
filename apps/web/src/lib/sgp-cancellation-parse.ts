/** Códigos de contrato_status confirmados nas imagens da API (não usar status de título). */
export const SGP_CONTRACT_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  CANCELLED: 3,
  SUSPENDED: 4,
  TECHNICAL_INVIABILITY: 5,
  NEW: 6,
  ACTIVE_REDUCED_SPEED: 7,
} as const;

export const ACTIVE_SERVICE_CODES = new Set<number>([
  SGP_CONTRACT_STATUS.ACTIVE,
  SGP_CONTRACT_STATUS.NEW,
  SGP_CONTRACT_STATUS.ACTIVE_REDUCED_SPEED,
]);

export const CANCELLED_CODE = SGP_CONTRACT_STATUS.CANCELLED;

const STATUS_LABELS: Record<number, string> = {
  1: "Ativo",
  2: "Inativo",
  3: "Cancelado",
  4: "Suspenso",
  5: "Inviabilidade Técnica",
  6: "Novo",
  7: "Ativo com velocidade reduzida",
};

/** Datas de status opcionais. Nunca dataCadastro, vencimento ou pagamento. O sample mascarado não traz data de cancelamento. */
const CANCEL_DATE_KEYS = ["data_status", "dataStatus", "data_contrato_status", "dataContratoStatus"];

export type NormalizedSgpContract = {
  sgpCustomerId: string;
  sgpContractId: string;
  statusCode: number | null;
  statusLabel: string;
  reason: string | null;
  planName: string | null;
  statusDate: Date | null;
  isCancelled: boolean;
  isActiveService: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function parseDate(value: unknown): Date | null {
  const text = asText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = text.length === 10 ? `${text}T12:00:00.000Z` : text;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (br) {
    const date = new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function mapContractStatus(raw: unknown): { code: number | null; label: string } {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return { code: raw, label: STATUS_LABELS[raw] ?? String(raw) };
  }
  const text = asText(raw);
  if (!text) return { code: null, label: "Não informado" };
  const numeric = Number(text);
  if (Number.isInteger(numeric) && STATUS_LABELS[numeric]) {
    return { code: numeric, label: STATUS_LABELS[numeric] };
  }
  const folded = text.toLowerCase();
  if (folded.includes("velocidade reduzida")) return { code: 7, label: STATUS_LABELS[7] };
  if (folded.includes("inviabilidade")) return { code: 5, label: STATUS_LABELS[5] };
  if (folded.startsWith("cancel")) return { code: 3, label: STATUS_LABELS[3] };
  if (folded.startsWith("suspens")) return { code: 4, label: STATUS_LABELS[4] };
  if (folded.startsWith("inativ")) return { code: 2, label: STATUS_LABELS[2] };
  if (folded === "novo" || folded.startsWith("novo ")) return { code: 6, label: STATUS_LABELS[6] };
  if (folded.startsWith("ativo")) return { code: 1, label: STATUS_LABELS[1] };
  return { code: null, label: text };
}

function planFromContract(contract: Record<string, unknown>) {
  const services = Array.isArray(contract.servicos) ? contract.servicos : [];
  for (const service of services) {
    const row = asRecord(service);
    const plan = asRecord(row?.plano);
    const named = asText(plan?.descricao) ?? asText(row?.plano);
    if (named) return named;
  }
  return asText(contract.plano) ?? asText(contract.plano_nome);
}

function statusDateFromContract(contract: Record<string, unknown>) {
  for (const key of CANCEL_DATE_KEYS) {
    const date = parseDate(contract[key]);
    if (date) return date;
  }
  return null;
}

export function normalizeContract(customerId: string, contract: Record<string, unknown>): NormalizedSgpContract | null {
  const sgpContractId = asText(contract.id) ?? asText(contract.contrato) ?? asText(contract.contrato_id);
  if (!sgpContractId) return null;
  const mapped = mapContractStatus(contract.contrato_status ?? contract.status);
  const isCancelled = mapped.code === CANCELLED_CODE;
  const isActiveService = mapped.code != null && ACTIVE_SERVICE_CODES.has(mapped.code);
  return {
    sgpCustomerId: customerId,
    sgpContractId,
    statusCode: mapped.code,
    statusLabel: mapped.label,
    reason: asText(contract.motivo_status) ?? asText(contract.motivo),
    planName: planFromContract(contract),
    statusDate: statusDateFromContract(contract),
    isCancelled,
    isActiveService,
  };
}

export function extractContractsFromClientesPayload(body: unknown): NormalizedSgpContract[] {
  const root = asRecord(body);
  const list = Array.isArray(body)
    ? body
    : Array.isArray(root?.clientes)
      ? root!.clientes
      : Array.isArray(root?.data)
        ? root!.data
        : [];
  const out: NormalizedSgpContract[] = [];
  for (const item of list) {
    const customer = asRecord(item);
    if (!customer) continue;
    const customerId = asText(customer.id) ?? asText(customer.cliente_id);
    if (!customerId) continue;
    const contracts = Array.isArray(customer.contratos) ? customer.contratos : [];
    if (!contracts.length && (customer.contrato || customer.contrato_id || customer.status || customer.contrato_status)) {
      const single = normalizeContract(customerId, customer);
      if (single) out.push(single);
      continue;
    }
    for (const contract of contracts) {
      const row = asRecord(contract);
      if (!row) continue;
      const normalized = normalizeContract(customerId, row);
      if (normalized) out.push(normalized);
    }
  }
  return out;
}

export function paginationFromPayload(body: unknown) {
  const root = asRecord(body);
  const nested = asRecord(root?.paginacao) ?? root ?? {};
  return {
    offset: Number(nested.offset ?? 0) || 0,
    limit: Number(nested.limit ?? 0) || 0,
    parcial: Number(nested.parcial ?? 0) || 0,
    total: typeof nested.total === "number" ? nested.total : null,
  };
}

export function redactSgpLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSgpLog);
  const row = asRecord(value);
  if (!row) return value;
  const blocked = new Set([
    "token",
    "app",
    "senha",
    "password",
    "contratoCentralSenha",
    "wifi_password",
    "wifi_password_5",
    "cpfcnpj",
    "cpf",
    "cnpj",
    "documento",
  ]);
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !blocked.has(key) && !/senha|password|token|secret|cpf/i.test(key))
      .map(([key, nested]) => [key, redactSgpLog(nested)]),
  );
}
