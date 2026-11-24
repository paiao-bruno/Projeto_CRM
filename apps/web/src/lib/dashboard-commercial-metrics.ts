/**
 * Dicionário das métricas comerciais (fonte: funil da organização autenticada).
 *
 * | Indicador | Fonte real | Unidade | Fórmula | Data | Escopo | Disponibilidade |
 * | Base convertida | 1ª Sucesso (pagamento confirmado) | clientes ou oportunidades | únicos com conversão até a data de referência | occurredAt / DealHistory SUCESSO | tenant | calculável |
 * | Oportunidades no período | Deal.createdAt | oportunidades | distinct id criados no intervalo | createdAt | tenant | calculável |
 * | Valor estimado | Deal.valueCents das criadas no intervalo | centavos BRL | soma inteira | createdAt | tenant | complementar; não é receita |
 * | Receita recebida | DealPaymentConfirmation ativa | centavos BRL | soma de amountCents com paidAt no intervalo e reversedAt nulo | paidAt | tenant | calculável |
 * | Novas conversões | 1ª Sucesso no intervalo | clientes ou deals | firsts no range | occurredAt | tenant | calculável |
 * | Conversão em Sucesso | coorte createdAt ∩ Sucesso até o fim | taxa | convertidas / criadas | createdAt + conversão | tenant | sem amostra se criadas=0 |
 * | Metas | CommercialGoal | count | realizado/meta | horizonte próprio | tenant | meta 0 = sem cumprimento |
 * | Cancelamentos | FunnelCommercialEvent CANCELLATION | clientes | únicos no período; taxa = perdidos da base inicial / base inicial | occurredAt | convertidos do funil | só após status CHURNED registrado |
 * | Mix de planos | Customer.planName ou contrato mais recente | clientes convertidos | categorias exclusivas + Não informado | data de referência (plano atual) | tenant | exige customerId |
 * | LTV | — | — | — | — | — | não calculado |
 */
import { ratio, relativeChange, type PeriodRange } from "./dashboard-periods";

export type CommercialEvent = {
  id: string;
  type: "CONVERSION" | "CANCELLATION";
  dealId: string | null;
  customerId: string | null;
  occurredAt: Date;
};

export type FunnelDealSnapshot = {
  id: string;
  customerId: string | null;
  createdAt: Date;
  valueCents: number;
  currency: string;
  status: string;
};

export function inRange(date: Date, range: Pick<PeriodRange, "from" | "toExclusive">) {
  return date >= range.from && date < range.toExclusive;
}

export function firstConversionByDeal(events: CommercialEvent[]) {
  const map = new Map<string, CommercialEvent>();
  for (const event of events) {
    if (event.type !== "CONVERSION" || !event.dealId) continue;
    const current = map.get(event.dealId);
    if (!current || event.occurredAt < current.occurredAt) map.set(event.dealId, event);
  }
  return [...map.values()];
}

export function firstConversionByCustomer(events: CommercialEvent[]) {
  const map = new Map<string, CommercialEvent>();
  for (const event of firstConversionByDeal(events)) {
    if (!event.customerId) continue;
    const current = map.get(event.customerId);
    if (!current || event.occurredAt < current.occurredAt) map.set(event.customerId, event);
  }
  return [...map.values()];
}

export function convertedBaseUntil(events: CommercialEvent[], untilExclusive: Date) {
  const conversions = firstConversionByDeal(events).filter((event) => event.occurredAt < untilExclusive);
  const withCustomer = conversions.filter((event) => event.customerId);
  const uniqueCustomers = new Set(withCustomer.map((event) => event.customerId as string));
  const identityReliable = conversions.length > 0 && withCustomer.length === conversions.length;
  return {
    identityReliable,
    count: identityReliable ? uniqueCustomers.size : conversions.length,
    unit: identityReliable ? ("customers" as const) : ("deals" as const),
    conversions,
  };
}

export function newConversionsInRange(events: CommercialEvent[], range: Pick<PeriodRange, "from" | "toExclusive">) {
  const firsts = firstConversionByDeal(events);
  const withCustomer = firsts.filter((event) => event.customerId);
  const identityReliable = firsts.length > 0 && withCustomer.length === firsts.length;
  const pool = identityReliable ? firstConversionByCustomer(events) : firsts;
  return {
    identityReliable,
    count: pool.filter((event) => inRange(event.occurredAt, range)).length,
    unit: identityReliable ? ("customers" as const) : ("deals" as const),
  };
}

export function createdOpportunities(deals: FunnelDealSnapshot[], range: Pick<PeriodRange, "from" | "toExclusive">) {
  const ids = new Set<string>();
  for (const deal of deals) {
    if (inRange(deal.createdAt, range)) ids.add(deal.id);
  }
  return ids.size;
}

export function cohortConversionRate(
  deals: FunnelDealSnapshot[],
  events: CommercialEvent[],
  range: Pick<PeriodRange, "from" | "toExclusive">,
) {
  const createdIds = deals.filter((deal) => inRange(deal.createdAt, range)).map((deal) => deal.id);
  const created = new Set(createdIds);
  const converted = firstConversionByDeal(events).filter(
    (event) => event.dealId && created.has(event.dealId) && event.occurredAt < range.toExclusive,
  );
  return {
    created: created.size,
    converted: converted.length,
    rate: ratio(converted.length, created.size),
  };
}

export type PaymentConfirmation = {
  dealId: string;
  amountCents: number;
  paidAt: Date;
  reversedAt: Date | null;
};

export function confirmedRevenue(payments: PaymentConfirmation[], range: Pick<PeriodRange, "from" | "toExclusive">) {
  let cents = 0;
  let count = 0;
  for (const payment of payments) {
    if (payment.reversedAt) continue;
    if (!inRange(payment.paidAt, range)) continue;
    cents += payment.amountCents;
    count += 1;
  }
  return { cents, count };
}

export function estimatedValueCreated(deals: FunnelDealSnapshot[], range: Pick<PeriodRange, "from" | "toExclusive">) {
  let cents = 0;
  let missing = 0;
  const currencies = new Set<string>();
  for (const deal of deals) {
    if (!inRange(deal.createdAt, range)) continue;
    currencies.add(deal.currency || "BRL");
    if (!deal.valueCents) missing += 1;
    else cents += deal.valueCents;
  }
  return { cents, missing, mixedCurrency: currencies.size > 1, currencies: [...currencies] };
}

export function cancellationCounts(events: CommercialEvent[], range: Pick<PeriodRange, "from" | "toExclusive">) {
  const conversionsUntilStart = convertedBaseUntil(events, range.from);
  const startIds = new Set(
    conversionsUntilStart.conversions
      .map((event) => event.customerId)
      .filter((id): id is string => Boolean(id)),
  );
  const cancels = events.filter((event) => event.type === "CANCELLATION" && inRange(event.occurredAt, range));
  const uniqueCustomers = new Set(cancels.map((event) => event.customerId).filter((id): id is string => Boolean(id)));
  const fromStart = [...uniqueCustomers].filter((id) => startIds.has(id)).length;
  return {
    quantity: uniqueCustomers.size,
    startBase: startIds.size,
    lostFromStart: fromStart,
    rate: ratio(fromStart, startIds.size),
    available: events.some((event) => event.type === "CANCELLATION"),
  };
}

export function goalAttainment(realized: number, target: number | null) {
  if (target == null || target <= 0) {
    return { realized, target, fulfillment: null, deviation: null };
  }
  return {
    realized,
    target,
    fulfillment: realized / target,
    deviation: (realized - target) / target,
  };
}

export function formatChangeLabel(change: ReturnType<typeof relativeChange>) {
  if (change.kind === "none" || change.value == null) return "Sem base de comparação";
  const sign = change.value > 0 ? "+" : "";
  return `${sign}${change.value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
