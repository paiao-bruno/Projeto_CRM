import { Prisma } from "@prisma/client";
import {
  cancellationCounts,
  cohortConversionRate,
  confirmedRevenue,
  convertedBaseUntil,
  createdOpportunities,
  estimatedValueCreated,
  goalAttainment,
  newConversionsInRange,
  type CommercialEvent,
  type FunnelDealSnapshot,
} from "@/lib/dashboard-commercial-metrics";
import {
  DASHBOARD_TIMEZONE,
  formatYmd,
  horizonRange,
  inclusiveRange,
  monthCloses,
  parseDashboardPeriod,
  previousRange,
  relativeChange,
  type HorizonKind,
  type PeriodRange,
} from "@/lib/dashboard-periods";
import { SALES_FUNNEL_STAGE_CODES } from "../../../../shared/sales-funnel.constants";
import type { ServerAuthUser } from "./auth";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";

const HORIZONS: Array<{ kind: HorizonKind; label: string }> = [
  { kind: "weekly", label: "Semanal" },
  { kind: "biweekly", label: "Quinzenal" },
  { kind: "monthly", label: "Mensal" },
  { kind: "quarterly", label: "Trimestral" },
  { kind: "semiannual", label: "Semestral" },
  { kind: "annual", label: "Anual" },
];

function tenantTimezone(settings: Prisma.JsonValue | null | undefined) {
  if (settings && typeof settings === "object" && !Array.isArray(settings) && typeof (settings as { timezone?: unknown }).timezone === "string") {
    return (settings as { timezone: string }).timezone;
  }
  return DASHBOARD_TIMEZONE;
}

function asEvents(rows: Array<{ id: string; type: string; dealId: string | null; customerId: string | null; occurredAt: Date }>): CommercialEvent[] {
  return rows
    .filter((row) => row.type === "CONVERSION" || row.type === "CANCELLATION")
    .map((row) => ({
      id: row.id,
      type: row.type as CommercialEvent["type"],
      dealId: row.dealId,
      customerId: row.customerId,
      occurredAt: row.occurredAt,
    }));
}

export class DashboardCommercialService {
  constructor(private readonly prisma = getPrisma()) {}

  async commercial(user: ServerAuthUser, query: URLSearchParams, now = new Date()) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { settings: true } });
    const timeZone = tenantTimezone(tenant?.settings);
    const period = parseDashboardPeriod(
      { from: query.get("from"), to: query.get("to"), preset: query.get("preset") },
      now,
      timeZone,
    );
    const previousSpec = previousRange(period.fromYmd, period.toYmdInclusive, period.comparisonKind);
    const previous = inclusiveRange(previousSpec.fromYmd, previousSpec.toYmdInclusive, timeZone, "comparison");

    const [deals, storedEvents, history, goals, customers, contracts, payments] = await Promise.all([
      this.prisma.deal.findMany({
        where: { tenantId: user.tenantId },
        select: { id: true, customerId: true, createdAt: true, valueCents: true, currency: true, status: true },
      }),
      this.prisma.funnelCommercialEvent.findMany({
        where: { tenantId: user.tenantId },
        select: { id: true, type: true, dealId: true, customerId: true, occurredAt: true },
      }),
      this.prisma.dealHistory.findMany({
        where: { tenantId: user.tenantId, action: "stage_changed" },
        select: { id: true, dealId: true, createdAt: true, newValue: true },
      }),
      this.prisma.commercialGoal.findMany({ where: { tenantId: user.tenantId } }),
      this.prisma.customer.findMany({
        where: { tenantId: user.tenantId, deletedAt: null },
        select: { id: true, planName: true, status: true },
      }),
      this.prisma.contract.findMany({
        where: { tenantId: user.tenantId, deletedAt: null },
        select: { customerId: true, planName: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.dealPaymentConfirmation.findMany({
        where: { tenantId: user.tenantId },
        select: { dealId: true, amountCents: true, paidAt: true, reversedAt: true },
      }),
    ]);

    const events = this.mergeConversionHistory(deals, storedEvents, history);
    const dealSnapshots: FunnelDealSnapshot[] = deals;
    const current = this.computeSlice(dealSnapshots, events, payments, period);
    const prior = this.computeSlice(dealSnapshots, events, payments, previous);
    const monthlyFinance = period.preset === "month_to_date" || period.comparisonKind === "previous_month" || period.comparisonKind === "equivalent_elapsed";
    const identityReliable = convertedBaseUntil(events, period.toExclusive).identityReliable;

    const acquisitionMetric = "new_conversions";
    const horizons = HORIZONS.map((item) => {
      const horizon = horizonRange(item.kind, period.toYmdInclusive, timeZone);
      const realized = newConversionsInRange(events, horizon).count;
      const goal = goals.find((row) => (row.metric === acquisitionMetric || row.metric === "new_funnel_conversions" || row.metric === "new_converted_customers") && row.kind === item.kind);
      const attainment = goalAttainment(realized, goal?.targetValue ?? null);
      const isCurrentMonth = item.kind === "monthly" && horizon.fromYmd.slice(0, 7) === formatYmd(now, timeZone).slice(0, 7);
      return {
        kind: item.kind,
        label: item.kind === "monthly" && isCurrentMonth ? "Mês atual" : item.label,
        fromYmd: horizon.fromYmd,
        toYmdInclusive: horizon.toYmdInclusive,
        metric: acquisitionMetric,
        unit: identityReliable ? "clientes convertidos" : "oportunidades ativadas",
        ...attainment,
        ring: Math.min(1, attainment.fulfillment ?? 0),
      };
    });

    const baseNow = convertedBaseUntil(events, period.toExclusive);
    const basePrev = convertedBaseUntil(events, previous.toExclusive);
    const evolution = monthCloses(period.toYmdInclusive, 6).map((closeYmd, index, list) => {
      const close = inclusiveRange(closeYmd, closeYmd, timeZone, "close").toExclusive;
      const realized = convertedBaseUntil(events, close).count;
      const stockGoal = goals.find((row) => row.kind === "base_stock");
      const partial = closeYmd === period.toYmdInclusive && index === list.length - 1;
      return {
        closeYmd,
        label: closeYmd.slice(0, 7),
        realized,
        target: stockGoal ? stockGoal.targetValue : null,
        partial,
      };
    });

    const planMix = this.planMix(baseNow.conversions.map((event) => event.customerId), customers, contracts);
    const cancels = cancellationCounts(events, period);
    const cancelsPrev = cancellationCounts(events, previous);
    const strategic = goals.find((row) => row.kind === "strategic");
    const strategicResult = strategic
      ? goalAttainment(baseNow.count, strategic.targetValue)
      : null;

    const insights = this.insights({
      current,
      prior,
      period,
      previous,
      horizons,
      cancels,
      cancelsPrev,
      planMix,
      baseNow: baseNow.count,
      basePrev: basePrev.count,
    });

    return {
      generatedAt: now.toISOString(),
      timeZone,
      referenceYmd: period.toYmdInclusive,
      period: {
        fromYmd: period.fromYmd,
        toYmdInclusive: period.toYmdInclusive,
        from: period.from.toISOString(),
        toExclusive: period.toExclusive.toISOString(),
        preset: period.preset,
        comparisonKind: period.comparisonKind,
        comparisonLabel: period.comparisonLabel,
        previousFromYmd: previous.fromYmd,
        previousToYmdInclusive: previous.toYmdInclusive,
      },
      coverage: {
        conversionSource:
          "Primeira transição canônica para Sucesso com pagamento qualificável confirmado (DealHistory.stage_changed + FunnelCommercialEvent). Reentrada e edição de campanha não contam de novo.",
        conversionStage: SALES_FUNNEL_STAGE_CODES.SUCESSO,
        paymentConfirmedRevenue: true,
        paymentNote:
          "Receita soma DealPaymentConfirmation ativa pela data paidAt. Estorno (reversedAt) exclui o valor. Taxa de instalação e fatura aberta não entram. Valor estimado do cartão Kanban não é receita.",
        cancellations: cancels.available
          ? "Cancelamentos explícitos (status CHURNED de cliente já convertido no funil), registrados a partir desta versão."
          : "Não há eventos de cancelamento comercial registrados. Oportunidades perdidas não são cancelamentos.",
        identityReliable,
        historyStartsFrom: events.length
          ? events.reduce((min, event) => (event.occurredAt < min ? event.occurredAt : min), events[0].occurredAt).toISOString()
          : null,
        ltv: false,
      },
      cards: {
        base: {
          label: identityReliable ? "Total de clientes — base do funil" : "Oportunidades em Sucesso",
          hint: identityReliable
            ? "Clientes únicos com primeira conversão válida até a data de referência. Não é a base cadastral nem a base ativa."
            : "Sem identidade de cliente nas oportunidades convertidas. Conta oportunidades únicas que chegaram a Sucesso com pagamento confirmado.",
          value: baseNow.count,
          change: relativeChange(baseNow.count, basePrev.count),
          available: true,
        },
        created: {
          label: "Oportunidades no período",
          hint: "Criadas no intervalo pela data de criação, incluindo perdidas e arquivadas. Mudança de etapa posterior não cria outro evento.",
          value: current.created,
          change: relativeChange(current.created, prior.created),
          available: true,
        },
        finance: {
          label: monthlyFinance ? "Receita Mensal" : "Receita no período",
          hint: `Pagamentos confirmados no funil (${current.revenue.count} confirmação(ões)). Estimado das oportunidades criadas: ${current.estimated.cents} centavos (${current.estimated.missing} sem valor). Não usa fatura aberta nem etapa Ativação.`,
          valueCents: current.revenue.cents,
          estimatedCents: current.estimated.cents,
          missing: current.estimated.missing,
          available: true,
          unavailableReason: null,
        },
        newConversions: {
          label: identityReliable ? "Novos clientes" : "Novas conversões do funil",
          hint: identityReliable
            ? "Clientes únicos cuja primeira conversão válida ocorreu no intervalo."
            : "Primeira chegada de cada oportunidade a Sucesso no intervalo.",
          value: current.newConversions,
          change: relativeChange(current.newConversions, prior.newConversions),
          available: true,
        },
        conversionRate: {
          label: "Conversão em Sucesso",
          hint: "Oportunidades criadas no intervalo que atingiram Sucesso válido até o fim do recorte ÷ criadas no intervalo.",
          rate: current.cohort.rate,
          created: current.cohort.created,
          converted: current.cohort.converted,
          deltaPoints: current.cohort.rate != null && prior.cohort.rate != null
            ? (current.cohort.rate - prior.cohort.rate) * 100
            : null,
          available: current.cohort.created > 0,
        },
      },
      horizons,
      cancellations: {
        available: cancels.available,
        quantity: cancels.available ? cancels.quantity : null,
        rate: cancels.available ? cancels.rate : null,
        startBase: cancels.startBase,
        lostFromStart: cancels.lostFromStart,
        quantityChange: cancels.available ? relativeChange(cancels.quantity, cancelsPrev.quantity) : { kind: "none", value: null },
        rateDeltaPoints:
          cancels.available && cancels.rate != null && cancelsPrev.rate != null
            ? (cancels.rate - cancelsPrev.rate) * 100
            : null,
        series: this.cancellationSeries(events, period, timeZone),
        reason: cancels.available
          ? null
          : "Sem eventos de cancelamento. Perder uma oportunidade no Kanban não cancela cliente.",
      },
      baseEvolution: {
        realizedMetric: identityReliable ? "clientes convertidos acumulados" : "oportunidades em Sucesso acumuladas",
        targetMetric: "tamanho de base (meta base_stock), distinta da meta de novas aquisições",
        months: evolution,
      },
      planMix,
      insights,
      strategic: strategic
        ? {
            target: strategic.targetValue,
            realized: baseNow.count,
            message: `${baseNow.count} de ${strategic.targetValue} ${identityReliable ? "clientes" : "conversões em Sucesso"} alcançados`,
            onTrack: strategicResult?.fulfillment != null ? strategicResult.fulfillment >= 1 : null,
          }
        : null,
      goals: goals.map((goal) => ({
        id: goal.id,
        metric: goal.metric,
        unit: goal.unit,
        kind: goal.kind,
        targetValue: goal.targetValue,
      })),
    };
  }

  async upsertGoal(user: ServerAuthUser, body: Record<string, unknown>) {
    const kind = String(body.kind ?? "");
    const allowed = new Set([...HORIZONS.map((item) => item.kind), "strategic", "base_stock"]);
    if (!allowed.has(kind)) throw new HttpError(422, "Horizonte de meta inválido.");
    const targetValue = Number(body.targetValue);
    if (!Number.isInteger(targetValue) || targetValue < 0 || targetValue > 10_000_000) {
      throw new HttpError(422, "Meta deve ser um inteiro não negativo.");
    }
    const metric = String(body.metric ?? "new_conversions");
    if (!["new_conversions", "new_funnel_conversions", "new_converted_customers", "base_stock"].includes(metric)) {
      throw new HttpError(422, "Métrica de meta inválida.");
    }
    return this.prisma.commercialGoal.upsert({
      where: { tenantId_metric_kind: { tenantId: user.tenantId, metric, kind } },
      update: { targetValue, unit: "count", updatedAt: new Date() },
      create: {
        tenantId: user.tenantId,
        metric,
        kind,
        unit: "count",
        targetValue,
        createdByMemberId: user.memberId,
      },
    });
  }

  private mergeConversionHistory(
    deals: Array<{ id: string; customerId: string | null }>,
    stored: Array<{ id: string; type: string; dealId: string | null; customerId: string | null; occurredAt: Date }>,
    history: Array<{ id: string; dealId: string; createdAt: Date; newValue: Prisma.JsonValue }>,
  ): CommercialEvent[] {
    const events = asEvents(stored);
    const seenDeals = new Set(events.filter((event) => event.type === "CONVERSION" && event.dealId).map((event) => event.dealId as string));
    const dealCustomer = new Map(deals.map((deal) => [deal.id, deal.customerId]));
    for (const row of history) {
      const code =
        row.newValue && typeof row.newValue === "object" && !Array.isArray(row.newValue)
          ? String((row.newValue as { stageCode?: unknown }).stageCode ?? "")
          : "";
      if (code !== SALES_FUNNEL_STAGE_CODES.SUCESSO) continue;
      if (seenDeals.has(row.dealId)) continue;
      seenDeals.add(row.dealId);
      events.push({
        id: `history:${row.id}`,
        type: "CONVERSION",
        dealId: row.dealId,
        customerId: dealCustomer.get(row.dealId) ?? null,
        occurredAt: row.createdAt,
      });
    }
    return events;
  }

  private computeSlice(
    deals: FunnelDealSnapshot[],
    events: CommercialEvent[],
    payments: Array<{ dealId: string; amountCents: number; paidAt: Date; reversedAt: Date | null }>,
    range: PeriodRange,
  ) {
    return {
      created: createdOpportunities(deals, range),
      newConversions: newConversionsInRange(events, range).count,
      estimated: estimatedValueCreated(deals, range),
      revenue: confirmedRevenue(payments, range),
      cohort: cohortConversionRate(deals, events, range),
    };
  }

  private planMix(
    convertedCustomerIds: Array<string | null>,
    customers: Array<{ id: string; planName: string | null }>,
    contracts: Array<{ customerId: string; planName: string | null }>,
  ) {
    const ids = [...new Set(convertedCustomerIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) {
      return {
        available: false,
        unit: "clientes convertidos do funil",
        total: 0,
        slices: [],
        reason: "Não há clientes identificados nas conversões do funil para montar o mix de planos.",
      };
    }
    const customerMap = new Map(customers.map((row) => [row.id, row]));
    const latestPlan = new Map<string, string | null>();
    for (const contract of contracts) {
      if (!latestPlan.has(contract.customerId)) latestPlan.set(contract.customerId, contract.planName);
    }
    const counts = new Map<string, number>();
    for (const id of ids) {
      const named = customerMap.get(id)?.planName?.trim() || latestPlan.get(id)?.trim() || "Não informado";
      counts.set(named, (counts.get(named) ?? 0) + 1);
    }
    const slices = [...counts.entries()]
      .map(([name, count]) => ({ name, count, share: count / ids.length }))
      .sort((a, b) => b.count - a.count);
    return { available: true, unit: "clientes convertidos do funil", total: ids.length, slices, reason: null };
  }

  private cancellationSeries(events: CommercialEvent[], period: PeriodRange, timeZone: string) {
    const months = monthCloses(period.toYmdInclusive, 6);
    return months.map((closeYmd, index) => {
      const startYmd = `${closeYmd.slice(0, 7)}-01`;
      const range = inclusiveRange(startYmd, closeYmd, timeZone, "month");
      const counts = cancellationCounts(events, range);
      return {
        closeYmd,
        label: closeYmd.slice(0, 7),
        quantity: counts.available ? counts.quantity : null,
        partial: index === months.length - 1 && closeYmd === period.toYmdInclusive,
      };
    });
  }

  private insights(input: {
    current: ReturnType<DashboardCommercialService["computeSlice"]>;
    prior: ReturnType<DashboardCommercialService["computeSlice"]>;
    period: PeriodRange;
    previous: PeriodRange;
    horizons: Array<{ kind: string; label: string; fulfillment: number | null; realized: number; target: number | null }>;
    cancels: ReturnType<typeof cancellationCounts>;
    cancelsPrev: ReturnType<typeof cancellationCounts>;
    planMix: { slices: Array<{ name: string; share: number }>; available: boolean };
    baseNow: number;
    basePrev: number;
  }) {
    const items: Array<{ id: string; text: string }> = [];
    const periodLabel = `${input.period.fromYmd} a ${input.period.toYmdInclusive}`;
    const missed = input.horizons.filter((item) => item.target != null && (item.fulfillment ?? 0) < 1);
    const beaten = input.horizons.filter((item) => item.target != null && (item.fulfillment ?? 0) >= 1);
    if (beaten.length) {
      items.push({
        id: "horizon-hit",
        text: `Meta de novas conversões superada no horizonte ${beaten[0].label.toLowerCase()} (${beaten[0].realized} realizado, meta ${beaten[0].target}) no recorte ancorado em ${input.period.toYmdInclusive}.`,
      });
    }
    if (missed.length) {
      items.push({
        id: "horizon-miss",
        text: `Meta de novas conversões não atingida no horizonte ${missed[0].label.toLowerCase()} (${missed[0].realized} de ${missed[0].target}) até ${input.period.toYmdInclusive}.`,
      });
    }
    const baseChange = relativeChange(input.baseNow, input.basePrev);
    if (baseChange.value != null) {
      items.push({
        id: "base-change",
        text: `Base comercial convertida ${baseChange.value >= 0 ? "cresceu" : "recuou"} ${Math.abs(baseChange.value).toFixed(1)}% frente a ${input.previous.fromYmd}–${input.previous.toYmdInclusive}.`,
      });
    }
    if (input.cancels.available && input.cancels.rate != null) {
      items.push({
        id: "cancel-rate",
        text: `Taxa de perda da base inicial no período ${periodLabel}: ${(input.cancels.rate * 100).toFixed(1)}% (${input.cancels.lostFromStart} de ${input.cancels.startBase}).`,
      });
    }
    if (input.planMix.available && input.planMix.slices[0]) {
      const top = input.planMix.slices[0];
      items.push({
        id: "plan-mix",
        text: `Maior participação no mix na data de referência: ${top.name} (${(top.share * 100).toFixed(1)}% dos clientes convertidos do funil).`,
      });
    }
    if (input.current.cohort.created === 0) {
      items.push({
        id: "no-sample",
        text: `Sem oportunidades criadas em ${periodLabel}; a conversão em Sucesso fica sem amostra.`,
      });
    }
    if (!items.length) {
      items.push({
        id: "empty",
        text: `Cobertura insuficiente para insights quantitativos no período ${periodLabel}.`,
      });
    }
    return items;
  }
}

let singleton: DashboardCommercialService | null = null;
export function getDashboardCommercialService() {
  singleton ??= new DashboardCommercialService();
  return singleton;
}
