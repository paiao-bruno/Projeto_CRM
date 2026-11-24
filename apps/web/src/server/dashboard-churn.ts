import {
  CHURN_HORIZONS,
  compareChurnStatus,
  datedCoverage,
  lostCustomers,
  reasonSlices,
  type ChurnHorizonKind,
} from "@/lib/churn-metrics";
import {
  DASHBOARD_TIMEZONE,
  horizonRange,
  inclusiveRange,
  lastYmdOfMonth,
  monthCloses,
  parseDashboardPeriod,
  previousRange,
  relativeChange,
} from "@/lib/dashboard-periods";
import { SGP_CONTRACT_STATUS } from "@/lib/sgp-cancellation-parse";
import type { ServerAuthUser } from "./auth";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { listSgpContractsByStatus, SGP_CLIENTES_ENDPOINT, SgpReadError } from "./sgp-churn-client";
import { getSgpChurnCredentialsService } from "./sgp-churn-credentials";

const METRIC = "churn_rate";

export class DashboardChurnService {
  constructor(private readonly prisma = getPrisma()) {}

  async overview(user: ServerAuthUser, query: URLSearchParams, now = new Date()) {
    const timeZone = DASHBOARD_TIMEZONE;
    const preset = query.get("preset") || "last_12_closed_months";
    const period = parseDashboardPeriod({ from: query.get("from"), to: query.get("to"), preset }, now, timeZone);
    const credentials = await getSgpChurnCredentialsService().getPublic(user);
    const snapshot = await this.latestComplete(user.tenantId);
    const rows = snapshot
      ? await this.prisma.sgpChurnContract.findMany({ where: { tenantId: user.tenantId, snapshotId: snapshot.id } })
      : [];
    const hasDates = datedCoverage(rows);
    const rangeFilter = hasDates ? period : undefined;
    const lost = lostCustomers(rows, rangeFilter);
    const activeNow = new Set(rows.filter((row) => row.isActiveService).map((row) => row.sgpCustomerId));
    const unit = "clientes";
    const goals = await this.prisma.commercialGoal.findMany({
      where: { tenantId: user.tenantId, metric: METRIC },
    });
    const cards = CHURN_HORIZONS.map((item) => {
      const horizon = horizonRange(item.kind, period.toYmdInclusive, timeZone);
      const lostInHorizon = lostCustomers(rows, hasDates ? horizon : undefined);
      const goal = goals.find((row) => row.kind === item.kind);
      const targetBp = goal ? goal.targetValue : null;
      const startBase = null;
      const rate = hasDates ? null : null;
      const status = compareChurnStatus(rate, targetBp);
      return {
        kind: item.kind,
        label: item.label,
        fromYmd: horizon.fromYmd,
        toYmdInclusive: horizon.toYmdInclusive,
        targetBp,
        targetLabel: targetBp == null ? "Meta não configurada" : `Meta: ≤ ${(targetBp / 100).toFixed(2).replace(".", ",")}%`,
        realized: rate,
        status,
        cancellations: hasDates ? lostInHorizon.length : lostCustomers(rows).length,
        partialMonth: horizon.toYmdInclusive !== lastYmdOfMonth(horizon.toYmdInclusive),
        coverage: hasDates
          ? "Clientes perdidos com data de status no horizonte. Sem base inicial B(P): taxa indisponível. Não some os seis cartões."
          : "Posição atual: clientes sem contrato ativo (1/6/7) e com cancelado (3). Sem data efetiva; os seis horizontes repetem a mesma fotografia.",
        formula: "Churn(P)=C(P)/B(P)×100. C(P)=clientes da base inicial que perderam o último contrato ativo. B(P) requer histórico de ativos no início de P.",
      };
    });

    const previousSpec = previousRange(period.fromYmd, period.toYmdInclusive, period.comparisonKind);
    const previous = inclusiveRange(previousSpec.fromYmd, previousSpec.toYmdInclusive, timeZone, "comparison");
    const lostPrev = hasDates ? lostCustomers(rows, previous).length : null;
    const reasons = reasonSlices(lost);
    const monthlyGoal = goals.find((row) => row.kind === "monthly")?.targetValue ?? null;
    const evolution = monthCloses(period.toYmdInclusive, 12).map((closeYmd) => {
      const start = `${closeYmd.slice(0, 7)}-01`;
      const month = inclusiveRange(start, closeYmd, timeZone, "month");
      const monthLost = hasDates ? lostCustomers(rows, month).length : null;
      return {
        label: closeYmd.slice(0, 7),
        closeYmd,
        churn: null,
        meta: monthlyGoal == null ? null : monthlyGoal / 10_000,
        lost: monthLost,
        coverage: hasDates ? "contagem no mês; taxa sem B(P)" : "sem data de status",
      };
    });

    const insights = this.insights(cards, reasons, lost.length, activeNow.size);

    return {
      generatedAt: now.toISOString(),
      timeZone,
      period: {
        fromYmd: period.fromYmd,
        toYmdInclusive: period.toYmdInclusive,
        preset: period.preset,
        comparisonLabel: period.comparisonLabel,
      },
      source: {
        name: "SGP",
        endpoint: SGP_CLIENTES_ENDPOINT,
        method: "POST",
        configured: credentials.configured,
        apiHost: credentials.apiHost,
        lastSyncAt: snapshot?.finishedAt?.toISOString() ?? null,
        coverage: snapshot?.coverage ?? "Nenhuma sincronização completa publicada.",
        snapshotStatus: snapshot?.status ?? "none",
      },
      unit,
      dictionary: {
        cancelledContracts: "Contratos com contrato_status=3. Inativo/Suspenso/Inviabilidade não entram.",
        lostCustomers: "Clientes SGP sem contrato ativo (1, 6 ou 7) e com ao menos um cancelado (3).",
        activeCustomers: "Posição atual: clientes com contrato 1, 6 ou 7 na última fotografia.",
        rate: "Indisponível sem B(P) histórica. Não usar ativos de hoje como denominador de cancelamentos passados.",
      },
      cards,
      evolution,
      reasons: {
        total: lost.length,
        unit: hasDates
          ? "clientes perdidos com data de status no período do filtro"
          : "clientes perdidos na posição atual (mesma unidade dos cartões)",
        slices: reasons,
      },
      indicators: {
        activeCustomers: { value: activeNow.size, label: "Posição atual", at: snapshot?.finishedAt?.toISOString() ?? null },
        cancellations: {
          value: lost.length,
          change: lostPrev == null ? { kind: "none", value: null } : relativeChange(lost.length, lostPrev),
        },
        churn: { value: null, deltaPoints: null },
      },
      insights,
      goals: goals.map((goal) => ({ kind: goal.kind, targetValue: goal.targetValue })),
    };
  }

  async sync(user: ServerAuthUser, fetchImpl: typeof fetch = fetch) {
    const runtime = await getSgpChurnCredentialsService().runtime(user.tenantId);
    if (!runtime) throw new HttpError(422, "Configure a leitura SGP nesta aba antes de atualizar.");
    const startedAt = new Date();
    try {
      const cancelledPage = await listSgpContractsByStatus(runtime, SGP_CONTRACT_STATUS.CANCELLED, fetchImpl);
      const activePage = await listSgpContractsByStatus(
        runtime,
        `${SGP_CONTRACT_STATUS.ACTIVE},${SGP_CONTRACT_STATUS.NEW},${SGP_CONTRACT_STATUS.ACTIVE_REDUCED_SPEED}`,
        fetchImpl,
      );
      const merged = new Map<string, (typeof cancelledPage.contracts)[number]>();
      for (const row of [...cancelledPage.contracts, ...activePage.contracts]) {
        const current = merged.get(row.sgpContractId);
        if (!current || row.isCancelled) merged.set(row.sgpContractId, row);
      }
      const contracts = [...merged.values()];
      const coverage = datedCoverage(contracts)
        ? "Contratos atualmente cancelados (status 3) e ativos (1,6,7), com data de status quando o SGP envia o campo. Não reconstitui cancelamentos reativados entre coletas."
        : "Contratos atualmente cancelados por contrato_status=3 e ativos 1/6/7. O retorno não trouxe data efetiva de cancelamento; não é histórico completo de churn.";

      const snapshot = await this.prisma.$transaction(async (tx) => {
        const created = await tx.sgpChurnSnapshot.create({
          data: {
            tenantId: user.tenantId,
            integrationId: runtime.integrationId,
            status: "COMPLETE",
            coverage,
            sourceEndpoint: SGP_CLIENTES_ENDPOINT,
            pageCount: cancelledPage.pageCount + activePage.pageCount,
            startedAt,
            finishedAt: new Date(),
            metadata: { cancelledPages: cancelledPage.pageCount, activePages: activePage.pageCount, contracts: contracts.length },
          },
        });
        if (contracts.length) {
          await tx.sgpChurnContract.createMany({
            data: contracts.map((row) => ({
              tenantId: user.tenantId,
              snapshotId: created.id,
              sgpCustomerId: row.sgpCustomerId,
              sgpContractId: row.sgpContractId,
              statusCode: row.statusCode,
              statusLabel: row.statusLabel,
              reason: row.reason,
              planName: row.planName,
              statusDate: row.statusDate,
              isCancelled: row.isCancelled,
              isActiveService: row.isActiveService,
            })),
          });
        }
        return created;
      });
      return { ok: true, snapshotId: snapshot.id, coverage, contracts: contracts.length };
    } catch (error) {
      const message = error instanceof SgpReadError ? error.message : "Falha ao sincronizar o SGP.";
      await this.prisma.sgpChurnSnapshot.create({
        data: {
          tenantId: user.tenantId,
          integrationId: runtime.integrationId,
          status: "FAILED",
          coverage: "Falha; a última fotografia completa permanece em uso.",
          sourceEndpoint: SGP_CLIENTES_ENDPOINT,
          startedAt,
          finishedAt: new Date(),
          errorMessage: message,
        },
      });
      throw new HttpError(error instanceof SgpReadError && error.code === "auth" ? 401 : 502, message);
    }
  }

  async upsertGoal(user: ServerAuthUser, body: Record<string, unknown>) {
    const kind = String(body.kind ?? "") as ChurnHorizonKind;
    if (!CHURN_HORIZONS.some((item) => item.kind === kind)) throw new HttpError(422, "Horizonte de meta inválido.");
    const percent = Number(body.targetPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new HttpError(422, "Meta deve ser um percentual entre 0 e 100.");
    }
    const targetValue = Math.round(percent * 100);
    return this.prisma.commercialGoal.upsert({
      where: { tenantId_metric_kind: { tenantId: user.tenantId, metric: METRIC, kind } },
      update: { targetValue, unit: "bp", updatedAt: new Date() },
      create: {
        tenantId: user.tenantId,
        metric: METRIC,
        kind,
        unit: "bp",
        targetValue,
        createdByMemberId: user.memberId,
      },
    });
  }

  private latestComplete(tenantId: string) {
    return this.prisma.sgpChurnSnapshot.findFirst({
      where: { tenantId, status: "COMPLETE" },
      orderBy: { finishedAt: "desc" },
    });
  }

  private insights(
    cards: Array<{ kind: string; label: string; status: string; cancellations: number }>,
    reasons: Array<{ name: string; share: number }>,
    lost: number,
    active: number,
  ) {
    const items: Array<{ id: string; text: string; kind: "fact" | "recommendation" }> = [];
    const annual = cards.find((card) => card.kind === "annual");
    if (annual?.status === "above") {
      items.push({ id: "annual-above", text: `O horizonte anual está acima da meta configurada (${annual.cancellations} perdas na cobertura disponível).`, kind: "fact" });
    } else if (annual?.status === "within") {
      items.push({ id: "annual-within", text: "O horizonte anual está dentro da meta configurada, com a cobertura informada nos cartões.", kind: "fact" });
    } else {
      items.push({ id: "no-rate", text: "A taxa de churn ainda não é calculável: falta a base ativa no início de cada intervalo (B(P)).", kind: "fact" });
    }
    const attention = cards.find((card) => card.kind === "weekly" || card.kind === "monthly");
    if (attention) {
      items.push({
        id: "recent",
        text: `${attention.label}: ${attention.cancellations} cancelamento(s) na unidade de clientes perdidos da fotografia.`,
        kind: "fact",
      });
    }
    if (reasons[0] && reasons[0].name !== "Sem classificação") {
      items.push({
        id: "reason",
        text: `Maior motivo informado pelo SGP: ${reasons[0].name} (${(reasons[0].share * 100).toFixed(1)}% da unidade da rosca).`,
        kind: "fact",
      });
    } else {
      items.push({
        id: "no-reason",
        text: "O SGP não enviou motivos classificáveis (campo motivo_status vazio). A rosca usa “Sem classificação”.",
        kind: "fact",
      });
    }
    items.push({
      id: "retain",
      text: active
        ? `Há ${active} cliente(s) com contrato ativo na posição atual e ${lost} perda(s) na cobertura. Priorize retenção nos motivos de maior participação, sem acionar o SGP por aqui.`
        : "Sem clientes ativos na fotografia; valide a conexão SGP e a cobertura da última sincronização antes de uma ação de retenção.",
      kind: "recommendation",
    });
    return items.slice(0, 4);
  }
}

let singleton: DashboardChurnService | null = null;
export function getDashboardChurnService() {
  singleton ??= new DashboardChurnService();
  return singleton;
}
