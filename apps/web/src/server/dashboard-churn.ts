import {
  CHURN_HORIZONS,
  compareChurnStatus,
  datedCoverage,
  lostCustomers,
  reasonSlices,
  type ChurnHorizonKind,
} from "../lib/churn-metrics";
import {
  DASHBOARD_TIMEZONE,
  horizonRange,
  inclusiveRange,
  lastYmdOfMonth,
  monthCloses,
  parseDashboardPeriod,
  previousRange,
  relativeChange,
} from "../lib/dashboard-periods";
import {
  allSgpCandidatesDenied,
  canPublishSnapshot,
  displayCancellations,
  isFreshSnapshot,
  isStaleRunning,
  lifecycleFromState,
  nextChurnAttemptAt,
  shouldSkipDeniedAuth,
  snapshotMatchesOrigin,
  SGP_CHURN_REFRESH_MS,
  SGP_CHURN_RETRY_MS,
} from "../lib/sgp-churn-lifecycle";
import { SGP_CONTRACT_STATUS } from "../lib/sgp-cancellation-parse";
import type { ServerAuthUser } from "./auth";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { publishEvent } from "./realtime";
import { listSgpContractsByStatus, probeSgpAuth, SGP_CLIENTES_ENDPOINT, SgpReadError } from "./sgp-churn-client";
import { getSgpChurnCredentialsService, type SgpChurnRuntime } from "./sgp-churn-credentials";

const METRIC = "churn_rate";
const deniedAuthRetried = new Set<string>();

export class DashboardChurnService {
  constructor(private readonly prisma = getPrisma()) {}

  async overview(user: ServerAuthUser, query: URLSearchParams, now = new Date()) {
    const timeZone = DASHBOARD_TIMEZONE;
    const preset = query.get("preset") || "last_12_closed_months";
    const period = parseDashboardPeriod({ from: query.get("from"), to: query.get("to"), preset }, now, timeZone);
    const credentials = await getSgpChurnCredentialsService().getPublic(user);
    const runtime = await getSgpChurnCredentialsService().runtime(user.tenantId);
    const snapshot = await this.latestComplete(user.tenantId, runtime);
    const running = await this.latestRunning(user.tenantId);
    const lastFailed = await this.latestFailed(user.tenantId);
    const ready = Boolean(snapshot);
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
      const rate = null;
      const count = displayCancellations(ready, hasDates ? lostInHorizon.length : lostCustomers(rows).length);
      return {
        kind: item.kind,
        label: item.label,
        fromYmd: horizon.fromYmd,
        toYmdInclusive: horizon.toYmdInclusive,
        targetBp,
        targetLabel: targetBp == null ? "Meta não configurada" : `Meta: ≤ ${(targetBp / 100).toFixed(2).replace(".", ",")}%`,
        realized: rate,
        status: compareChurnStatus(rate, targetBp),
        cancellations: count,
        partialMonth: horizon.toYmdInclusive !== lastYmdOfMonth(horizon.toYmdInclusive),
        coverage: !ready
          ? "Sem fotografia completa publicada. Quantidade indisponível (não é zero)."
          : hasDates
            ? "Clientes perdidos com data de status no horizonte. Sem base inicial B(P): taxa indisponível. Não some os seis cartões."
            : "Posição atual: clientes sem contrato ativo (1/6/7) e com cancelado (3). Sem data efetiva; os seis horizontes repetem a mesma fotografia.",
        formula: "Churn(P)=C(P)/B(P)×100. C(P)=clientes da base inicial que perderam o último contrato ativo. B(P) requer histórico de ativos no início de P.",
      };
    });

    const previousSpec = previousRange(period.fromYmd, period.toYmdInclusive, period.comparisonKind);
    const previous = inclusiveRange(previousSpec.fromYmd, previousSpec.toYmdInclusive, timeZone, "comparison");
    const lostPrev = ready && hasDates ? lostCustomers(rows, previous).length : null;
    const reasons = ready ? reasonSlices(lost) : [];
    const monthlyGoal = goals.find((row) => row.kind === "monthly")?.targetValue ?? null;
    const evolution = monthCloses(period.toYmdInclusive, 12).map((closeYmd) => {
      const start = `${closeYmd.slice(0, 7)}-01`;
      const month = inclusiveRange(start, closeYmd, timeZone, "month");
      const monthLost = ready && hasDates ? lostCustomers(rows, month).length : null;
      return {
        label: closeYmd.slice(0, 7),
        closeYmd,
        churn: null,
        meta: monthlyGoal == null ? null : monthlyGoal / 10_000,
        lost: monthLost,
        coverage: hasDates ? "contagem no mês; taxa sem B(P)" : "sem data de status",
      };
    });

    const lifecycle = lifecycleFromState({
      configured: credentials.configured,
      decryptFailed: (credentials.storedRows ?? 0) > 0 && (credentials.decryptableRows ?? 0) === 0,
      authDenied: lastFailed?.status === "AUTH_DENIED" && !ready,
      running: Boolean(running),
      hasComplete: ready,
      fresh: isFreshSnapshot(snapshot?.finishedAt, now),
      lastError: lastFailed?.errorMessage,
    });

    const insights = ready
      ? this.insights(cards, reasons, lost.length, activeNow.size)
      : [{ id: "waiting", text: this.waitingMessage(lifecycle), kind: "fact" as const }];

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
        configured: credentials.configured,
        tokenConfigured: credentials.tokenConfigured,
        apiHost: credentials.apiHost,
        lastSyncAt: snapshot?.finishedAt?.toISOString() ?? null,
        coverage: snapshot?.coverage ?? "Nenhuma sincronização completa publicada.",
        snapshotStatus: snapshot?.status ?? "none",
        lifecycle,
        stale: ready && !isFreshSnapshot(snapshot?.finishedAt, now),
        lastError: lastFailed && (!snapshot || (lastFailed.finishedAt && snapshot.finishedAt && lastFailed.finishedAt > snapshot.finishedAt))
          ? lastFailed.errorMessage
          : null,
        lastSuccessAt: snapshot?.finishedAt?.toISOString() ?? null,
        lastAttemptAt: (running?.startedAt ?? lastFailed?.finishedAt ?? snapshot?.finishedAt)?.toISOString() ?? null,
        nextAttemptAt: nextChurnAttemptAt({
          lifecycle,
          lastSuccessAt: snapshot?.finishedAt ?? null,
          lastAttemptAt: running?.startedAt ?? lastFailed?.finishedAt ?? snapshot?.finishedAt ?? null,
          now,
        }),
        refreshMs: SGP_CHURN_REFRESH_MS,
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
        total: ready ? lost.length : null,
        unit: hasDates
          ? "clientes perdidos com data de status no período do filtro"
          : "clientes perdidos na posição atual (mesma unidade dos cartões)",
        slices: reasons,
      },
      indicators: {
        activeCustomers: {
          value: ready ? activeNow.size : null,
          label: "Posição atual",
          at: snapshot?.finishedAt?.toISOString() ?? null,
        },
        cancellations: {
          value: ready ? lost.length : null,
          change: lostPrev == null ? { kind: "none" as const, value: null } : relativeChange(lost.length, lostPrev),
        },
        churn: { value: null, deltaPoints: null },
      },
      insights,
      goals: goals.map((goal) => ({ kind: goal.kind, targetValue: goal.targetValue })),
    };
  }

  async ensure(tenantId: string, options: { force?: boolean } = {}, fetchImpl: typeof fetch = fetch) {
    const creds = getSgpChurnCredentialsService();
    const candidates = await creds.runtimesForAuthFallback(tenantId);
    if (!candidates.length) return { status: "needs_config" as const };
    const now = new Date();
    await this.reapStaleRunning(tenantId, now);
    const runtime = (await creds.runtime(tenantId)) ?? candidates[0];
    const complete = await this.latestComplete(tenantId, runtime);
    if (!options.force && complete && isFreshSnapshot(complete.finishedAt, now, SGP_CHURN_REFRESH_MS)) {
      return { status: "fresh" as const, snapshotId: complete.id };
    }
    const lastFailed = await this.latestFailed(tenantId);
    if (
      shouldSkipDeniedAuth({
        force: Boolean(options.force),
        allDenied: allSgpCandidatesDenied(candidates),
        retriedThisProcess: deniedAuthRetried.has(tenantId),
        lastAuthDeniedAt: lastFailed?.status === "AUTH_DENIED" ? lastFailed.finishedAt : null,
        now,
      })
    ) {
      return { status: "auth_denied" as const };
    }
    if (allSgpCandidatesDenied(candidates)) deniedAuthRetried.add(tenantId);
    if (
      !options.force &&
      lastFailed?.status === "FAILED" &&
      isFreshSnapshot(lastFailed.finishedAt, now, SGP_CHURN_RETRY_MS)
    ) {
      return { status: "cooling" as const };
    }
    const running = await this.claimRunning(tenantId, runtime, now);
    if (!running) return { status: "syncing" as const };
    try {
      const accepted = await this.authenticate(tenantId, candidates, fetchImpl);
      if (!accepted) {
        await this.fail(tenantId, runtime, now, running.id, "AUTH_DENIED", "Autenticação recusada pelo SGP (app/token).");
        return { status: "auth_denied" as const };
      }
      const current = await creds.runtime(tenantId);
      if (!current || !canPublishSnapshot(accepted.credentialVersion, current.credentialVersion, accepted.apiHost, current.apiHost)) {
        await this.releaseRunning(running.id);
        return { status: "superseded" as const };
      }
      await this.collectAndPublish(tenantId, accepted, now, running.id, fetchImpl);
      return { status: "synced" as const };
    } catch (error) {
      const message = error instanceof SgpReadError ? error.message : "Falha ao sincronizar o SGP.";
      const status = error instanceof SgpReadError && error.code === "auth" ? "AUTH_DENIED" : "FAILED";
      await this.fail(tenantId, runtime, now, running.id, status, message);
      return { status: "failed" as const };
    }
  }

  async sync(user: ServerAuthUser, fetchImpl: typeof fetch = fetch) {
    const result = await this.ensure(user.tenantId, { force: true }, fetchImpl);
    if (result.status === "needs_config") throw new HttpError(422, "A leitura SGP ainda não tem credenciais neste tenant.");
    if (result.status === "auth_denied") throw new HttpError(401, "Autenticação recusada pelo SGP (app/token).");
    if (result.status === "failed") throw new HttpError(502, "Falha ao sincronizar o SGP.");
    return { ok: true, ...result };
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

  private async authenticate(tenantId: string, candidates: SgpChurnRuntime[], fetchImpl: typeof fetch) {
    const creds = getSgpChurnCredentialsService();
    for (const candidate of candidates) {
      try {
        await probeSgpAuth(candidate, fetchImpl);
        await creds.markAuth(tenantId, candidate.integrationId, true);
        return candidate;
      } catch (error) {
        if (error instanceof SgpReadError && error.code === "auth") {
          await creds.markAuth(tenantId, candidate.integrationId, false, error.message);
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  private async collectAndPublish(
    tenantId: string,
    runtime: SgpChurnRuntime,
    startedAt: Date,
    runningId: string,
    fetchImpl: typeof fetch,
  ) {
    const cancelledPage = await listSgpContractsByStatus(runtime, SGP_CONTRACT_STATUS.CANCELLED, fetchImpl);
    const activePage = await listSgpContractsByStatus(
      runtime,
      `${SGP_CONTRACT_STATUS.ACTIVE},${SGP_CONTRACT_STATUS.NEW},${SGP_CONTRACT_STATUS.ACTIVE_REDUCED_SPEED}`,
      fetchImpl,
    );
    const current = await getSgpChurnCredentialsService().runtime(tenantId);
    if (!current || !canPublishSnapshot(runtime.credentialVersion, current.credentialVersion, runtime.apiHost, current.apiHost)) {
      await this.releaseRunning(runningId);
      return;
    }
    const merged = new Map<string, (typeof cancelledPage.contracts)[number]>();
    for (const row of [...cancelledPage.contracts, ...activePage.contracts]) {
      const existing = merged.get(row.sgpContractId);
      if (!existing || row.isCancelled) merged.set(row.sgpContractId, row);
    }
    const contracts = [...merged.values()];
    const coverage = datedCoverage(contracts)
      ? "Contratos atualmente cancelados (status 3) e ativos (1,6,7), com data de status quando o SGP envia o campo. Não reconstitui cancelamentos reativados entre coletas."
      : "Contratos atualmente cancelados por contrato_status=3 e ativos 1/6/7. O retorno não trouxe data efetiva de cancelamento; não é histórico completo de churn.";
    await this.prisma.$transaction(async (tx) => {
      await tx.sgpChurnSnapshot.update({
        where: { id: runningId },
        data: {
          status: "COMPLETE",
          coverage,
          pageCount: cancelledPage.pageCount + activePage.pageCount,
          finishedAt: new Date(),
          errorMessage: null,
          metadata: {
            cancelledPages: cancelledPage.pageCount,
            activePages: activePage.pageCount,
            contracts: contracts.length,
            credentialVersion: runtime.credentialVersion,
            apiHost: runtime.apiHost,
            integrationId: runtime.integrationId,
          },
        },
      });
      if (contracts.length) {
        await tx.sgpChurnContract.createMany({
          data: contracts.map((row) => ({
            tenantId,
            snapshotId: runningId,
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
      await publishEvent(tx, { type: "sgp.churn.updated", tenantId });
    });
  }

  private async claimRunning(tenantId: string, runtime: SgpChurnRuntime, now: Date) {
    try {
      return await this.prisma.sgpChurnSnapshot.create({
        data: {
          tenantId,
          integrationId: runtime.integrationId,
          status: "RUNNING",
          coverage: "Sincronização em andamento.",
          sourceEndpoint: SGP_CLIENTES_ENDPOINT,
          startedAt: now,
          metadata: {
            credentialVersion: runtime.credentialVersion,
            apiHost: runtime.apiHost,
            integrationId: runtime.integrationId,
          },
        },
      });
    } catch {
      return null;
    }
  }

  private async fail(
    tenantId: string,
    runtime: SgpChurnRuntime,
    startedAt: Date,
    runningId: string,
    status: "FAILED" | "AUTH_DENIED",
    message: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sgpChurnSnapshot.update({
        where: { id: runningId },
        data: {
          status,
          coverage: "Falha; a última fotografia completa permanece em uso.",
          finishedAt: new Date(),
          errorMessage: message,
          metadata: {
            credentialVersion: runtime.credentialVersion,
            apiHost: runtime.apiHost,
            integrationId: runtime.integrationId,
          },
        },
      }).catch(async () => {
        await tx.sgpChurnSnapshot.create({
          data: {
            tenantId,
            integrationId: runtime.integrationId,
            status,
            coverage: "Falha; a última fotografia completa permanece em uso.",
            sourceEndpoint: SGP_CLIENTES_ENDPOINT,
            startedAt,
            finishedAt: new Date(),
            errorMessage: message,
          },
        });
      });
      void updated;
      await publishEvent(tx, { type: "sgp.churn.failed", tenantId });
    });
  }

  private releaseRunning(id: string) {
    return this.prisma.sgpChurnSnapshot.update({
      where: { id },
      data: { status: "FAILED", coverage: "Execução substituída por configuração mais nova.", finishedAt: new Date(), errorMessage: "superseded" },
    });
  }

  private async reapStaleRunning(tenantId: string, now: Date) {
    const running = await this.prisma.sgpChurnSnapshot.findMany({ where: { tenantId, status: "RUNNING" } });
    for (const row of running) {
      if (isStaleRunning(row.startedAt, now)) {
        await this.prisma.sgpChurnSnapshot.update({
          where: { id: row.id },
          data: { status: "FAILED", coverage: "Execução interrompida.", finishedAt: now, errorMessage: "timeout" },
        });
      }
    }
  }

  private async latestComplete(tenantId: string, runtime: { integrationId: string; apiHost: string } | null) {
    const rows = await this.prisma.sgpChurnSnapshot.findMany({
      where: { tenantId, status: "COMPLETE" },
      orderBy: { finishedAt: "desc" },
      take: 8,
    });
    return (
      rows.find((row) => snapshotMatchesOrigin(row.metadata, runtime?.integrationId, runtime?.apiHost)) ??
      rows[0] ??
      null
    );
  }

  private latestRunning(tenantId: string) {
    return this.prisma.sgpChurnSnapshot.findFirst({ where: { tenantId, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
  }

  private latestFailed(tenantId: string) {
    return this.prisma.sgpChurnSnapshot.findFirst({
      where: { tenantId, status: { in: ["FAILED", "AUTH_DENIED"] } },
      orderBy: { finishedAt: "desc" },
    });
  }

  private waitingMessage(lifecycle: string) {
    if (lifecycle === "needs_config") return "A leitura SGP deste tenant ainda não tem credenciais no servidor. Um administrador provisiona uma vez em Integrações.";
    if (lifecycle === "decrypt_failed") return "Há integração SGP gravada, mas o App/Token não puderam ser decifrados neste processo. Ainda não foi possível avaliar o histórico. Regrave as credenciais ou alinhe APP_ENCRYPTION_KEY.";
    if (lifecycle === "auth_denied") return "O SGP recusou App/Token. A quantidade não é zero; a fotografia não foi publicada.";
    if (lifecycle === "syncing" || lifecycle === "validating") return "Validando a conexão e sincronizando a fotografia de cancelamentos.";
    return "Ainda não há fotografia completa publicada para este recorte.";
  }

  private insights(
    cards: Array<{ kind: string; label: string; status: string; cancellations: number | null }>,
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
    if (attention && attention.cancellations != null) {
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
        : "Sem clientes ativos na fotografia; a recomendação de retenção espera a cobertura da última sincronização.",
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

export async function tickSgpChurn() {
  const creds = getSgpChurnCredentialsService();
  const tenants = await creds.listConfiguredTenantIds();
  const service = getDashboardChurnService();
  for (const tenantId of tenants) {
    try {
      await service.ensure(tenantId);
    } catch {
      /* tenant opcional: não derruba o worker */
    }
  }
}
