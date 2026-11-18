/** Regras de pagamento qualificável para a etapa Sucesso (sem efeito financeiro externo). */

export type InvoiceLike = {
  status: string;
  paidAt?: Date | string | null;
  amountCents?: number | null;
  deletedAt?: Date | string | null;
  origin?: string | null;
  metadata?: unknown;
  customerId?: string | null;
};

export function isInstallationCharge(invoice: Pick<InvoiceLike, "origin" | "metadata">) {
  const meta = invoice.metadata && typeof invoice.metadata === "object" ? invoice.metadata as Record<string, unknown> : {};
  const hay = [
    invoice.origin,
    meta.kind,
    meta.category,
    meta.chargeType,
    meta.type,
    typeof invoice.metadata === "string" ? invoice.metadata : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /instala/.test(hay) || hay.includes("installation") || hay.includes("taxa_instal");
}

export function isQualifyingPaidInvoice(invoice: InvoiceLike) {
  if (invoice.deletedAt) return false;
  if (invoice.status !== "PAID") return false;
  if (!invoice.paidAt) return false;
  if (!invoice.amountCents || invoice.amountCents <= 0) return false;
  if (isInstallationCharge(invoice)) return false;
  return true;
}

export function successEntryBlockers(input: {
  currentStageCode: string | null | undefined;
  hasActivationEvidence: boolean;
  hasQualifyingPayment: boolean;
}) {
  const blockers: string[] = [];
  if (input.currentStageCode === "SUCESSO") return blockers;
  if (!input.hasActivationEvidence) {
    blockers.push("O serviço precisa estar em Ativação (ou já ter passado por ela nesta oportunidade).");
  }
  if (input.currentStageCode !== "ATIVACAO" && input.currentStageCode !== "SUCESSO") {
    blockers.push("Mova o cartão para Ativação antes de Sucesso; etapas intermediárias não são preenchidas automaticamente.");
  }
  if (!input.hasQualifyingPayment) {
    blockers.push(
      "Confirme o primeiro pagamento qualificável do serviço (fatura paga vinculada ao cliente ou confirmação manual). Taxa de instalação, valor zerado ou comprovante não validado não qualificam.",
    );
  }
  return blockers;
}

export function formatConversion(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(rate) || !Number.isFinite(rate)) return "sem base";
  return `${(rate * 100).toFixed(1)}%`;
}
