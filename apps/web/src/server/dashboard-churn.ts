import {
  CHURN_HORIZONS,
  activeServiceContracts,
  churnHorizonLabel,
  cohortChurn,
  compareChurnStatus,
  datedCoverage,
  lostCustomers,
  periodReasonRows,
  reasonInsightText,
  reasonSlices,
  relationshipCustomers,
  snapshotSupportsOpeningBase,
  temporalCancellations,
  type ChurnHorizonKind,
} from "../lib/churn-metrics";
import { diffSnapshotTransitions } from "../lib/sgp-churn-observations";
import {
  DASHBOARD_TIMEZONE,
  formatYmd,
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
  isFreshSnapshot,
  isStaleRunning,
  latestDate,
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

export function clearSgpChurnAuthRetry(tenantId: string) {
  deniedAuthRetried.delete(tenantId);
}

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
    const latestJob = await this.latestJob(user.tenantId);
    const ready = Boolean(snapshot);
    const rows = snapshot
      ? await this.prisma.sgpChurnContract.findMany({ where: { tenantId: user.tenantId, snapshotId: snapshot.id } })
      : [];
    const observations = ready
      ? await this.prisma.sgpChurnObservation.findMany({ where: { tenantId: user.tenantId } })
      : [];
    const earliestComplete = await this.prisma.sgpChurnSnapshot.findFirst({
      where: { tenantId: user.tenantId, status: "COMPLETE", finishedAt: { not: null } },
      orderBy: { finishedAt: "asc" },
      select: { finishedAt: true },
    });
    const coverageStartedAt = earliestComplete?.finishedAt ?? snapshot?.finishedAt ?? null;
    const cohortIdsBySnapshot = new Map<string, string[]>();
    const startActiveIds = await this.cohortActiveIds(user.tenantId, period.from, runtime, cohortIdsBySnapshot);
    const periodTemporal = temporalCancellations({
      ready,
      rows,
      range: period,
      observations,
      coverageStartedAt,
    });
    const periodRows = periodReasonRows({ rows, range: period, observations, temporal: periodTemporal });
    const positionCancelled = rows.filter((row) => row.isCancelled);
    const activeContracts = activeServiceContracts(rows);
    const lostNow = lostCustomers(rows);
    const relatedNow = relationshipCustomers(rows);
    const unit = "contratos";
    const goals = await this.prisma.commercialGoal.findMany({
      where: { tenantId: user.tenantId, metric: METRIC },
    });
    const cards = await Promise.all(CHURN_HORIZONS.map(async (item) => {
      const horizon = horizonRange(item.kind, period.toYmdInclusive, timeZone);
      const temporal = temporalCancellations({
        ready,
        rows,
        range: horizon,
        observations,
        coverageStartedAt,
      });
      const horizonBase = await this.cohortActiveIds(user.tenantId, horizon.from, runtime, cohortIdsBySnapshot);
      const rate = cohortChurn({
        startActiveContractIds: horizonBase,
        cancelledContractIds: periodReasonRows({ rows, range: horizon, observations, temporal }).map((row) => row.sgpContractId),
      });
      const goal = goals.find((row) => row.kind === item.kind);
      const targetBp = goal ? goal.targetValue : null;
      const partialMonth = horizon.toYmdInclusive !== lastYmdOfMonth(horizon.toYmdInclusive);
      const todayYmd = formatYmd(now, timeZone);
      return {
        kind: item.kind,
        label: churnHorizonLabel(item.kind, horizon.toYmdInclusive, todayYmd, partialMonth),
        fromYmd: horizon.fromYmd,
        toYmdInclusive: horizon.toYmdInclusive,
        targetBp,
        targetLabel: targetBp == null ? "Meta não configurada" : `Meta: ≤ ${(targetBp / 100).toFixed(2).replace(".", ",")}%`,
        realized: rate,
        status: compareChurnStatus(rate, targetBp),
        cancellations: temporal.value,
        knownCancellations: temporal.known,
        temporalCoverage: temporal.coverage,
        partialMonth,
        coverage: !ready
          ? "Sem fotografia completa publicada. Quantidade indisponível (não é zero)."
          : temporal.coverage === "none"
            ? "Sem data efetiva nem transição contida neste intervalo. Não é o estoque atual."
            : temporal.coverage === "partial"
              ? `Contratos distintos com data efetiva ou transição observada contida no intervalo (${temporal.known} conhecidos; cobertura parcial).`
              : "Contratos distintos cancelados com data na fotografia atual neste intervalo. Não reconstitui reativações anteriores.",
        formula:
          "Ocorrências(P)=contratos distintos com data efetiva em P ou transição INTERVAL totalmente contida em P. Churn bruto=contratos da coorte (status 1 ou 7) na fronteira de P que cancelaram em P ÷ B(P)×100. B(P) exige fotografia completa com finishedAt em [início de P − 24h, início de P]; snapshot mais antigo não reconstitui a base. Não some os seis cartões.",
      };
    }));

    const previousSpec = previousRange(period.fromYmd, period.toYmdInclusive, period.comparisonKind);
    const previous = inclusiveRange(previousSpec.fromYmd, previousSpec.toYmdInclusive, timeZone, "comparison");
    const prevTemporal = temporalCancellations({ ready, rows, range: previous, observations, coverageStartedAt });
    const reasons = ready
      ? reasonSlices(periodTemporal.value == null ? positionCancelled : periodRows)
      : [];
    const monthlyGoal = goals.find((row) => row.kind === "monthly")?.targetValue ?? null;
    const evolution = monthCloses(period.toYmdInclusive, 12).map((closeYmd) => {
      const start = `${closeYmd.slice(0, 7)}-01`;
      const month = inclusiveRange(start, closeYmd, timeZone, "month");
      const monthCount = temporalCancellations({ ready, rows, range: month, observations, coverageStartedAt });
      return {
        label: closeYmd.slice(0, 7),
        closeYmd,
        churn: null,
        meta: monthlyGoal == null ? null : monthlyGoal / 10_000,
        lost: monthCount.value,
        cancellations: monthCount.value,
        coverage: monthCount.coverage,
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
    const lastAttemptAt = latestDate(running?.startedAt, latestJob?.startedAt, lastFailed?.startedAt, snapshot?.startedAt);
    const next = nextChurnAttemptAt({
      lifecycle,
      lastSuccessAt: snapshot?.finishedAt ?? null,
      lastAttemptAt,
      now,
    });

    const reasonsScope = periodTemporal.value == null ? "current_position" : "period";
    const insights = ready
      ? this.insights(
          cards,
          reasons,
          reasonsScope,
          periodTemporal.value,
          activeContracts.length,
          positionCancelled.length,
        )
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
        lastError:
          lastFailed && (!snapshot || (lastFailed.finishedAt && snapshot.finishedAt && lastFailed.finishedAt > snapshot.finishedAt))
            ? lastFailed.errorMessage
            : null,
        lastSuccessAt: snapshot?.finishedAt?.toISOString() ?? null,
        lastAttemptAt: lastAttemptAt?.toISOString() ?? null,
        lastAttemptStartedAt: lastAttemptAt?.toISOString() ?? null,
        lastAttemptKind: running ? "running" : latestJob?.status === "COMPLETE" ? "success" : latestJob?.status ?? null,
        nextAttemptAt: next.at,
        nextAttemptDelayed: next.delayed,
        nextAttemptBlocked: next.blocked,
        refreshMs: SGP_CHURN_REFRESH_MS,
        coverageStartedAt: coverageStartedAt?.toISOString() ?? null,
      },
      unit,
      dictionary: {
        cancelledContracts: "Posição atual: contratos com contrato_status=3 na última fotografia. Inativo/Suspenso/Inviabilidade/Novo não entram.",
        periodCancellations: "Ocorrências no período: contratos distintos com data efetiva comprovada no intervalo ou transição INTERVAL totalmente contida. FIRST_SEEN sem data não conta.",
        lostCustomers: "Clientes SGP sem vínculo 1/6/7 e com ao menos um cancelado (3). Não é a unidade dos cartões temporais.",
        activeCustomers: "Clientes com contrato em serviço (1 ou 7). Novo (6) não é serviço ativo.",
        rate: "Churn bruto de contratos da coorte inicial. B(P) só com fotografia completa na fronteira (até 24h antes do início). Snapshot antigo não reconstitui a base. Denominador 0 não vira 0%.",
      },
      position: {
        label: "Posição atual",
        at: snapshot?.finishedAt?.toISOString() ?? null,
        cancelledContracts: ready ? positionCancelled.length : null,
        lostCustomers: ready ? lostNow.length : null,
        activeServiceContracts: ready ? activeContracts.length : null,
        relationshipCustomers: ready ? relatedNow.size : null,
        undatedCancelledContracts: ready ? positionCancelled.filter((row) => !row.statusDate).length : null,
        unit: "contratos",
      },
      cards,
      evolution,
      reasons: {
        total: ready ? (periodTemporal.value == null ? positionCancelled.length : periodRows.length) : null,
        scope: periodTemporal.value == null ? "current_position" : "period",
        unit:
          periodTemporal.value == null
            ? "contratos atualmente cancelados (posição atual; não pertence ao filtro temporal)"
            : "contratos cancelados com evidência no período do filtro",
        slices: reasons,
      },
      indicators: {
        activeCustomers: {
          value: ready ? activeContracts.length : null,
          label: "Contratos com serviço ativo (1 e 7)",
          at: snapshot?.finishedAt?.toISOString() ?? null,
        },
        cancellations: {
          value: periodTemporal.value,
          change:
            prevTemporal.value == null || periodTemporal.value == null
              ? { kind: "none" as const, value: null }
              : relativeChange(periodTemporal.value, prevTemporal.value),
        },
        churn: {
          value: cohortChurn({
            startActiveContractIds: startActiveIds,
            cancelledContractIds: periodRows.map((row) => row.sgpContractId),
          }),
          deltaPoints: null,
        },
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
    const running = await this.claimRunning(tenantId, runtime, now, options.force ? "manual" : "auto");
    if (!running) return { status: "syncing" as const };
    try {
      const accepted = await this.authenticate(tenantId, candidates, fetchImpl);
      if (!accepted) {
        await this.fail(tenantId, runtime, now, running.id, "AUTH_DENIED", "Autenticação recusada pelo SGP.");
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
    if (result.status === "auth_denied") {
      const last = await this.latestFailed(user.tenantId);
      throw new HttpError(401, last?.errorMessage || "Autenticação recusada pelo SGP.");
    }
    if (result.status === "failed") {
      const last = await this.latestFailed(user.tenantId);
      throw new HttpError(502, last?.errorMessage || "Falha ao sincronizar o SGP.");
    }
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
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        await probeSgpAuth(candidate, fetchImpl);
        await creds.markAuth(tenantId, candidate.integrationId, true);
        return candidate;
      } catch (error) {
        lastError = error;
        if (error instanceof SgpReadError && error.code === "auth") {
          await creds.markAuth(tenantId, candidate.integrationId, false, error.message);
          continue;
        }
      }
    }
    if (lastError instanceof SgpReadError) throw lastError;
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
    const previous = await this.latestComplete(tenantId, runtime);
    const previousRows = previous
      ? await this.prisma.sgpChurnContract.findMany({ where: { tenantId, snapshotId: previous.id } })
      : [];
    const finishedAt = new Date();
    const transitions = diffSnapshotTransitions(previousRows, contracts, previous?.finishedAt ?? null, finishedAt);
    const coverage = datedCoverage(contracts)
      ? "Contratos atualmente cancelados (status 3) e em serviço (1,7), com data efetiva quando o objeto contrato envia o campo. Transições entre fotografias são INTERVAL; a primeira vista sem data é FIRST_SEEN e não data o cancelamento."
      : "Contratos atualmente cancelados por contrato_status=3 e em serviço 1/7. O objeto contrato desta coleta não trouxe data efetiva; títulos cancelados não são usados. Não é histórico remoto completo.";
    await this.prisma.$transaction(async (tx) => {
      await tx.sgpChurnSnapshot.update({
        where: { id: runningId },
        data: {
          status: "COMPLETE",
          coverage,
          pageCount: cancelledPage.pageCount + activePage.pageCount,
          finishedAt,
          errorMessage: null,
          metadata: {
            cancelledPages: cancelledPage.pageCount,
            activePages: activePage.pageCount,
            contracts: contracts.length,
            cancelledContracts: contracts.filter((row) => row.isCancelled).length,
            datedCancelled: contracts.filter((row) => row.isCancelled && row.statusDate).length,
            credentialVersion: runtime.credentialVersion,
            apiHost: runtime.apiHost,
            integrationId: runtime.integrationId,
            dateInventory: cancelledPage.dateInventory,
            transitions: transitions.length,
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
      if (transitions.length) {
        await tx.sgpChurnObservation.createMany({
          data: transitions.map((row) => ({
            tenantId,
            integrationId: runtime.integrationId,
            snapshotId: runningId,
            sgpCustomerId: row.sgpCustomerId,
            sgpContractId: row.sgpContractId,
            fromStatusCode: row.fromStatusCode,
            toStatusCode: row.toStatusCode,
            quality: row.quality,
            observedFrom: row.observedFrom,
            observedTo: row.observedTo,
            statusDate: row.statusDate,
            sourceEndpoint: SGP_CLIENTES_ENDPOINT,
          })),
          skipDuplicates: true,
        });
      }
      await publishEvent(tx, { type: "sgp.churn.updated", tenantId });
    });
  }

  private async claimRunning(tenantId: string, runtime: SgpChurnRuntime, now: Date, trigger: "auto" | "manual") {
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
            trigger,
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

  private latestJob(tenantId: string) {
    return this.prisma.sgpChurnSnapshot.findFirst({
      where: { tenantId },
      orderBy: { startedAt: "desc" },
    });
  }

  private async snapshotAtOrBefore(
    tenantId: string,
    at: Date,
    runtime: { integrationId: string; apiHost: string } | null,
  ) {
    const rows = await this.prisma.sgpChurnSnapshot.findMany({
      where: { tenantId, status: "COMPLETE", finishedAt: { lte: at } },
      orderBy: { finishedAt: "desc" },
      take: 8,
    });
    return rows.find((row) => snapshotMatchesOrigin(row.metadata, runtime?.integrationId, runtime?.apiHost)) ?? rows[0] ?? null;
  }

  private async cohortActiveIds(
    tenantId: string,
    at: Date,
    runtime: { integrationId: string; apiHost: string } | null,
    cache: Map<string, string[]>,
  ) {
    const snapshot = await this.snapshotAtOrBefore(tenantId, at, runtime);
    if (!snapshot || !snapshotSupportsOpeningBase(snapshot.finishedAt, at)) return null;
    const cached = cache.get(snapshot.id);
    if (cached) return cached;
    const rows = await this.prisma.sgpChurnContract.findMany({
      where: { tenantId, snapshotId: snapshot.id },
    });
    const ids = activeServiceContracts(rows).map((row) => row.sgpContractId);
    cache.set(snapshot.id, ids);
    return ids;
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
    reasons: Array<{ name: string; count: number; share: number }>,
    reasonsScope: "current_position" | "period",
    periodCount: number | null,
    activeContracts: number,
    positionCancelled: number,
  ) {
    const items: Array<{ id: string; text: string; kind: "fact" | "recommendation" }> = [];
    const annual = cards.find((card) => card.kind === "annual");
    if (annual?.status === "above") {
      items.push({ id: "annual-above", text: `O horizonte anual está acima da meta configurada (${annual.cancellations} contratos na cobertura disponível).`, kind: "fact" });
    } else if (annual?.status === "within") {
      items.push({ id: "annual-within", text: "O horizonte anual está dentro da meta configurada, com a cobertura informada nos cartões.", kind: "fact" });
    } else {
      items.push({ id: "no-rate", text: "A taxa de churn ainda não é calculável: falta B(P) de uma fotografia completa no início do intervalo.", kind: "fact" });
    }
    const attention = cards.find((card) => card.kind === "weekly" || card.kind === "monthly");
    if (attention && attention.cancellations != null) {
      items.push({
        id: "recent",
        text: `${attention.label}: ${attention.cancellations} contrato(s) cancelado(s) com evidência temporal neste horizonte.`,
        kind: "fact",
      });
    } else if (periodCount == null) {
      items.push({
        id: "no-period",
        text: `Há ${positionCancelled} contrato(s) atualmente cancelado(s) na fotografia; os cartões temporais ficam indisponíveis sem data efetiva ou transição contida.`,
        kind: "fact",
      });
    }
    items.push({
      id: "reason",
      text: reasonInsightText(reasons, reasonsScope),
      kind: "fact",
    });
    items.push({
      id: "retain",
      text: activeContracts
        ? `Há ${activeContracts} contrato(s) com serviço ativo (status 1 ou 7) na posição atual. Priorize retenção nos motivos de maior participação, sem acionar o SGP por aqui.`
        : "Sem contratos em serviço na fotografia; a recomendação de retenção espera a cobertura da última sincronização.",
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
