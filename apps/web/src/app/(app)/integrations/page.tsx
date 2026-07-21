"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  History,
  KeyRound,
  Plug,
  RefreshCcw,
  Save,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  IntegrationSyncRun,
  SgpCredentials,
  SgpCredentialsInput,
  SgpCredentialsUpdateInput,
  SgpDiscoveryPreview,
  SgpSyncHistoryEntry,
  SgpSyncHistoryListResponse,
  SgpSyncStartResponse,
} from "@/lib/types";

type ConnectionState = "idle" | "online" | "error";

type CredentialFormState = {
  name: string;
  apiUrl: string;
  apiPort: string;
  timeoutMs: string;
  app: string;
  token: string;
};

const emptyForm: CredentialFormState = {
  name: "SGP",
  apiUrl: "",
  apiPort: "",
  timeoutMs: "15000",
  app: "",
  token: "",
};

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: typeof Plug;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-5">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-1 text-xs text-emerald-300">{hint}</p>
        </div>
        <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
          <Icon size={22} />
        </span>
      </CardContent>
    </Card>
  );
}

function formatDuration(durationMs: number | null | undefined) {
  if (durationMs == null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function statusBadgeVariant(status: IntegrationSyncRun["status"]) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "PARTIAL") return "amber";
  if (status === "SKIPPED") return "slate";
  return "blue";
}

function HistoryStats({
  label,
  stats,
}: {
  label: string;
  stats: SgpSyncHistoryEntry["customers"];
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <p className="text-sm font-medium text-white">{label}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
        <span>Proc.: {stats.processed}</span>
        <span>Criados: {stats.created}</span>
        <span>Atualiz.: {stats.updated}</span>
        <span>Remov.: {stats.deleted}</span>
        <span>Ignor.: {stats.ignored}</span>
      </div>
    </div>
  );
}

function toFormState(credential: SgpCredentials): CredentialFormState {
  return {
    name: credential.name,
    apiUrl: credential.apiUrl,
    apiPort: credential.apiPort ?? "",
    timeoutMs: credential.timeoutMs ? String(credential.timeoutMs) : "15000",
    app: credential.app,
    token: "",
  };
}

export default function IntegrationsPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [loadingAction, setLoadingAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastPreview, setLastPreview] = useState<SgpDiscoveryPreview | null>(null);
  const [currentRun, setCurrentRun] = useState<IntegrationSyncRun | null>(null);
  const [syncHistory, setSyncHistory] = useState<SgpSyncHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");
  const [historyDetail, setHistoryDetail] = useState<IntegrationSyncRun | null>(null);
  const [credentials, setCredentials] = useState<SgpCredentials[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>("");
  const [form, setForm] = useState<CredentialFormState>(emptyForm);
  const [isCreating, setIsCreating] = useState(true);
  const [fullSync, setFullSync] = useState(false);

  const selectedCredential = useMemo(
    () => credentials.find((item) => item.id === selectedCredentialId) ?? null,
    [credentials, selectedCredentialId],
  );

  const loadCredentials = useCallback(async () => {
    if (!token) return;

    const items = await api.get<SgpCredentials[]>("/integrations/sgp/credentials", token);
    setCredentials(items);

    if (items.length === 0) {
      setSelectedCredentialId("");
      setForm(emptyForm);
      setIsCreating(true);
      return;
    }

    const current = items.find((item) => item.id === selectedCredentialId) ?? items[0];
    setSelectedCredentialId(current.id);
    setForm(toFormState(current));
    setIsCreating(false);
  }, [selectedCredentialId, token]);

  const loadSyncHistory = useCallback(async () => {
    if (!token) return;

    const response = await api.get<SgpSyncHistoryListResponse>(
      `/integrations/sgp/sync-runs?page=${historyPage}&limit=10`,
      token,
    );
    setSyncHistory(response.items);
    setHistoryTotalPages(response.totalPages || 1);
  }, [historyPage, token]);

  const loadHistoryDetail = useCallback(
    async (runId: string) => {
      if (!token) return;
      const detail = await api.get<IntegrationSyncRun>(`/integrations/sgp/sync-runs/${runId}`, token);
      setHistoryDetail(detail);
      setSelectedHistoryId(runId);
    },
    [token],
  );

  useEffect(() => {
    void loadCredentials().catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar credenciais SGP.");
    });
  }, [loadCredentials]);

  useEffect(() => {
    void loadSyncHistory().catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar histórico de sincronização.");
    });
  }, [loadSyncHistory]);

  async function runAction<T>(action: string, callback: () => Promise<T>) {
    setLoadingAction(action);
    setError("");
    setMessage("");

    try {
      return await callback();
    } catch (err) {
      const text = err instanceof Error ? err.message : "Erro inesperado.";
      setError(text);
      setConnectionState("error");
      throw err;
    } finally {
      setLoadingAction("");
    }
  }

  function buildPayload(): SgpCredentialsInput {
    return {
      name: form.name.trim() || "SGP",
      apiUrl: form.apiUrl.trim(),
      apiPort: form.apiPort.trim() || undefined,
      timeoutMs: form.timeoutMs.trim() ? Number(form.timeoutMs) : undefined,
      app: form.app.trim(),
      token: form.token.trim(),
    };
  }

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    await runAction("save", async () => {
      const payload = buildPayload();

      if (isCreating) {
        const created = await api.post<SgpCredentials>(
          "/integrations/sgp/credentials",
          payload,
          token,
        );
        setCredentials((current) => [created, ...current]);
        setSelectedCredentialId(created.id);
        setForm(toFormState(created));
        setIsCreating(false);
        setMessage("Credenciais SGP criadas com sucesso.");
        return;
      }

      if (!selectedCredentialId) return;

      const updatePayload: SgpCredentialsUpdateInput = {
        name: payload.name,
        apiUrl: payload.apiUrl,
        apiPort: payload.apiPort,
        timeoutMs: payload.timeoutMs,
        app: payload.app,
      };

      if (payload.token) {
        updatePayload.token = payload.token;
      }

      const updated = await api.patch<SgpCredentials>(
        `/integrations/sgp/credentials/${selectedCredentialId}`,
        updatePayload,
        token,
      );

      setCredentials((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setForm(toFormState(updated));
      setMessage("Credenciais SGP atualizadas com sucesso.");
    });
  }

  async function deleteCredentials() {
    if (!token || !selectedCredentialId) return;

    await runAction("delete", async () => {
      await api.delete<{ deleted: boolean; id: string }>(
        `/integrations/sgp/credentials/${selectedCredentialId}`,
        token,
      );
      setMessage("Credenciais SGP removidas.");
      setSelectedCredentialId("");
      await loadCredentials();
    });
  }

  async function testStoredCredentials() {
    if (!token) return;

    await runAction("test", async () => {
      if (selectedCredentialId) {
        await api.post<unknown>(
          `/integrations/sgp/credentials/${selectedCredentialId}/test`,
          {},
          token,
        );
      } else {
        const payload = buildPayload();
        await api.post<unknown>("/integrations/sgp/credentials/test", payload, token);
      }

      setConnectionState("online");
      setMessage("Conexão SGP validada com sucesso.");
      await loadCredentials();
    });
  }

  async function testSgp() {
    if (!token) return;

    await runAction("test-auth", async () => {
      await api.post<unknown>(
        "/integrations/sgp/test-auth",
        { payload: {}, credentialId: selectedCredentialId || undefined },
        token,
      );
      setConnectionState("online");
      setMessage("Autenticação SGP validada com sucesso.");
    });
  }

  async function discoverCustomers() {
    if (!token) return;

    await runAction("discover", async () => {
      const result = await api.post<SgpDiscoveryPreview>(
        "/integrations/sgp/discover/customers",
        {
          pagination: { offset: 0, limit: 25 },
          credentialId: selectedCredentialId || undefined,
        },
        token,
      );
      setLastPreview(result);
      setConnectionState("online");
      setMessage(`Preview processado: ${result.processed} clientes lidos.`);
    });
  }

  async function syncCustomers() {
    if (!token) return;

    await runAction("sync", async () => {
      const result = await api.post<SgpSyncStartResponse>(
        "/integrations/sgp/sync-customers",
        {
          pagination: { offset: 0, limit: 100 },
          credentialId: selectedCredentialId || undefined,
          full: fullSync,
        },
        token,
      );
      setConnectionState("online");
      setMessage(result.message);
      await pollSyncRun(result.runId);
    });
  }

  async function pollSyncRun(runId: string) {
    if (!token) return;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const run = await api.get<IntegrationSyncRun>(
        `/integrations/sgp/sync-runs/${runId}`,
        token,
      );
      setCurrentRun(run);

      if (run.status !== "RUNNING") {
        setMessage(`Sincronização finalizada com status ${run.status}.`);
        await loadSyncHistory();
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    setMessage("Sincronização ainda em execução. Consulte o histórico em alguns instantes.");
  }

  const visible = "sgp".includes(search.toLowerCase()) || "api externa".includes(search.toLowerCase());
  const activeCredentials = credentials.filter((item) => item.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold text-white">Integrations</h1>
          <p className="mt-1 text-slate-400">
            Connect platforms and tools that expand the ecosystem.
          </p>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Plug} title="Total Integrations" value={credentials.length} hint="SGP API" />
        <MetricCard icon={CheckCircle2} title="Active Integrations" value={activeCredentials || (connectionState === "online" ? 1 : 0)} hint={activeCredentials ? "configured" : connectionState === "online" ? "online" : "pending setup"} />
        <MetricCard icon={Activity} title="Last Preview" value={lastPreview?.processed ?? 0} hint="customers read" />
        <MetricCard icon={Database} title="Preview Relations" value={(lastPreview?.customers ?? []).reduce((total, item) => total + item.contractsCount + item.invoicesCount, 0)} hint="contracts + invoices" />
      </section>

      <Input
        placeholder="Search Integrations"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {error ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-200">
          {message}
        </div>
      ) : null}

      {visible ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="rounded-2xl bg-violet-400/10 p-3 text-violet-300">
                <KeyRound size={22} />
              </span>
              <div>
                <CardTitle>Credenciais SGP por empresa</CardTitle>
                <p className="text-sm text-slate-400">
                  Configure URL, app e token do SGP para o tenant atual.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {credentials.map((credential) => (
                <Button
                  key={credential.id}
                  type="button"
                  variant={credential.id === selectedCredentialId ? "default" : "secondary"}
                  onClick={() => {
                    setSelectedCredentialId(credential.id);
                    setForm(toFormState(credential));
                    setIsCreating(false);
                  }}
                >
                  {credential.name}
                </Button>
              ))}
              <Button
                type="button"
                variant={isCreating ? "default" : "secondary"}
                onClick={() => {
                  setIsCreating(true);
                  setSelectedCredentialId("");
                  setForm(emptyForm);
                }}
              >
                Nova credencial
              </Button>
            </div>

            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveCredentials}>
              <Input
                placeholder="Nome da integração"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                placeholder="URL da API SGP"
                value={form.apiUrl}
                onChange={(event) => setForm((current) => ({ ...current, apiUrl: event.target.value }))}
                required
              />
              <Input
                placeholder="Porta (opcional)"
                value={form.apiPort}
                onChange={(event) => setForm((current) => ({ ...current, apiPort: event.target.value }))}
              />
              <Input
                placeholder="Timeout em ms"
                value={form.timeoutMs}
                onChange={(event) => setForm((current) => ({ ...current, timeoutMs: event.target.value }))}
              />
              <Input
                placeholder="App"
                value={form.app}
                onChange={(event) => setForm((current) => ({ ...current, app: event.target.value }))}
                required
              />
              <Input
                placeholder={selectedCredential?.tokenConfigured ? `Token (${selectedCredential.tokenPreview})` : "Token"}
                type="password"
                value={form.token}
                onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))}
                required={isCreating}
              />

              <div className="md:col-span-2 flex flex-wrap gap-2">
                <Button disabled={Boolean(loadingAction)} type="submit">
                  <Save size={16} />
                  {isCreating ? "Salvar credenciais" : "Atualizar credenciais"}
                </Button>
                <Button
                  disabled={Boolean(loadingAction)}
                  type="button"
                  variant="secondary"
                  onClick={() => void testStoredCredentials()}
                >
                  <Search size={16} />
                  Testar credenciais
                </Button>
                {!isCreating && selectedCredentialId ? (
                  <Button
                    disabled={Boolean(loadingAction)}
                    type="button"
                    variant="secondary"
                    onClick={() => void deleteCredentials()}
                  >
                    <Trash2 size={16} />
                    Remover
                  </Button>
                ) : null}
              </div>
            </form>

            {selectedCredential ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={selectedCredential.status === "ACTIVE" ? "green" : "amber"}>
                    {selectedCredential.status}
                  </Badge>
                  <Badge variant={selectedCredential.healthStatus === "HEALTHY" ? "green" : "blue"}>
                    {selectedCredential.healthStatus}
                  </Badge>
                  {selectedCredential.tokenPreview ? (
                    <span>Token: {selectedCredential.tokenPreview}</span>
                  ) : null}
                </div>
                {selectedCredential.lastError ? (
                  <p className="mt-2 text-red-300">{selectedCredential.lastError}</p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {currentRun ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Status da sincronização</CardTitle>
                <p className="text-sm text-slate-400">Run ID: {currentRun.id}</p>
              </div>
              <Badge variant={statusBadgeVariant(currentRun.status)}>{currentRun.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-4">
              <p>Empresa: {currentRun.tenant.name}</p>
              <p>Usuário: {currentRun.triggeredBy?.name ?? "Sistema"}</p>
              <p>Início: {new Date(currentRun.startedAt).toLocaleString()}</p>
              <p>Duração: {formatDuration(currentRun.durationMs)}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <HistoryStats label="Clientes" stats={currentRun.customers} />
              <HistoryStats label="Contratos" stats={currentRun.contracts} />
              <HistoryStats label="Faturas" stats={currentRun.invoices} />
            </div>
            {currentRun.syncMode ? (
              <p className="text-sm text-slate-400">
                Modo: {currentRun.syncMode}
                {currentRun.trigger ? ` · origem ${currentRun.trigger}` : ""}
              </p>
            ) : null}
            {currentRun.errorMessage ? (
              <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{currentRun.errorMessage}</div>
            ) : null}
            {currentRun.errors.length ? (
              <div className="space-y-2">
                {currentRun.errors.slice(0, 5).map((item, index) => (
                  <div
                    className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300"
                    key={`${item.message}-${index}`}
                  >
                    {item.entity ? `${item.entity} · ` : ""}
                    {item.message}
                  </div>
                ))}
              </div>
            ) : null}
            {currentRun.logs?.length ? (
              <div className="space-y-2">
                {currentRun.logs.slice(0, 5).map((log) => (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300" key={log.id}>
                    {log.entity} · {log.action} · {log.status}
                    {log.message ? ` · ${log.message}` : ""}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {visible ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl bg-amber-400/10 p-3 text-amber-300">
                  <History size={22} />
                </span>
                <div>
                  <CardTitle>Histórico de sincronizações</CardTitle>
                  <p className="text-sm text-slate-400">
                    Registro completo de execuções SGP com métricas, erros e stacktrace.
                  </p>
                </div>
              </div>
              <Button disabled={Boolean(loadingAction)} type="button" variant="secondary" onClick={() => void loadSyncHistory()}>
                <RefreshCcw size={16} />
                Atualizar histórico
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/70 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Início</th>
                    <th className="px-4 py-3">Fim</th>
                    <th className="px-4 py-3">Duração</th>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Usuário</th>
                    <th className="px-4 py-3">Clientes</th>
                    <th className="px-4 py-3">Contratos</th>
                    <th className="px-4 py-3">Faturas</th>
                    <th className="px-4 py-3">Criados</th>
                    <th className="px-4 py-3">Atualiz.</th>
                    <th className="px-4 py-3">Remov.</th>
                    <th className="px-4 py-3">Ignor.</th>
                    <th className="px-4 py-3">Erros</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {syncHistory.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={14}>
                        Nenhuma sincronização registrada ainda.
                      </td>
                    </tr>
                  ) : (
                    syncHistory.map((item) => (
                      <tr
                        className={`cursor-pointer border-t border-slate-800 hover:bg-slate-900/60 ${selectedHistoryId === item.id ? "bg-slate-900/80" : ""}`}
                        key={item.id}
                        onClick={() => void loadHistoryDetail(item.id)}
                      >
                        <td className="px-4 py-3">{new Date(item.startedAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {item.finishedAt ? new Date(item.finishedAt).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">{formatDuration(item.durationMs)}</td>
                        <td className="px-4 py-3">{item.tenant.name}</td>
                        <td className="px-4 py-3">{item.triggeredBy?.name ?? "Sistema"}</td>
                        <td className="px-4 py-3">{item.customers.processed}</td>
                        <td className="px-4 py-3">{item.contracts.processed}</td>
                        <td className="px-4 py-3">{item.invoices.processed}</td>
                        <td className="px-4 py-3">{item.created}</td>
                        <td className="px-4 py-3">{item.updated}</td>
                        <td className="px-4 py-3">{item.deleted}</td>
                        <td className="px-4 py-3">{item.ignored}</td>
                        <td className="px-4 py-3">{item.errorsCount}</td>
                        <td className="px-4 py-3">
                          <Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-400">Página {historyPage} de {historyTotalPages}</p>
              <div className="flex gap-2">
                <Button
                  disabled={historyPage <= 1}
                  type="button"
                  variant="secondary"
                  onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </Button>
                <Button
                  disabled={historyPage >= historyTotalPages}
                  type="button"
                  variant="secondary"
                  onClick={() => setHistoryPage((current) => current + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>

            {historyDetail ? (
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">Detalhes da execução</p>
                    <p className="text-sm text-slate-400">{historyDetail.id}</p>
                  </div>
                  <Badge variant={statusBadgeVariant(historyDetail.status)}>{historyDetail.status}</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <HistoryStats label="Clientes" stats={historyDetail.customers} />
                  <HistoryStats label="Contratos" stats={historyDetail.contracts} />
                  <HistoryStats label="Faturas" stats={historyDetail.invoices} />
                </div>
                {historyDetail.errors.length ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">Erros</p>
                    {historyDetail.errors.map((item, index) => (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-100" key={`${item.message}-${index}`}>
                        {item.entity ? `${item.entity} · ` : ""}
                        {item.message}
                      </div>
                    ))}
                  </div>
                ) : null}
                {historyDetail.stackTrace ? (
                  <div>
                    <p className="mb-2 text-sm font-medium text-white">Stacktrace</p>
                    <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
                      {historyDetail.stackTrace}
                    </pre>
                  </div>
                ) : null}
                {historyDetail.logs?.length ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">Logs de entidades</p>
                    {historyDetail.logs.map((log) => (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300" key={log.id}>
                        {new Date(log.createdAt).toLocaleString()} · {log.entity} · {log.action} · {log.status}
                        {log.message ? ` · ${log.message}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {visible ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div className="flex items-center gap-4">
                <span className="rounded-2xl bg-sky-400/10 p-3 text-sky-300">
                  <Server size={24} />
                </span>
                <div>
                  <CardTitle>SGP</CardTitle>
                  <p className="mt-1 text-sm text-slate-400">
                    Clientes via /api/ura/clientes/ · Contratos via /api/contrato/list/ · Faturas via /api/ura/titulos/
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="blue">API Externa</Badge>
                    <Badge variant={connectionState === "online" ? "green" : connectionState === "error" ? "red" : "amber"}>
                      {connectionState === "online" ? "online" : connectionState === "error" ? "error" : "not tested"}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-sm text-slate-300">
                  <input
                    checked={fullSync}
                    onChange={(event) => setFullSync(event.target.checked)}
                    type="checkbox"
                  />
                  Sincronização completa
                </label>
                <Button disabled={Boolean(loadingAction) || credentials.length === 0} variant="secondary" onClick={testSgp}>
                  <Search size={16} />
                  Test Connection
                </Button>
                <Button disabled={Boolean(loadingAction) || credentials.length === 0} variant="secondary" onClick={discoverCustomers}>
                  <Activity size={16} />
                  Discover
                </Button>
                <Button disabled={Boolean(loadingAction) || credentials.length === 0} onClick={syncCustomers}>
                  <RefreshCcw className={loadingAction === "sync" ? "animate-spin" : ""} size={16} />
                  Sync Customers
                </Button>
              </div>
            </div>
          </CardHeader>
          {lastPreview ? (
            <CardContent className="grid gap-3 md:grid-cols-4">
              {[
                ["Processed", lastPreview.processed],
                ["Contracts", lastPreview.customers.reduce((total, item) => total + item.contractsCount, 0)],
                ["Invoices", lastPreview.customers.reduce((total, item) => total + item.invoicesCount, 0)],
                ["Preview", lastPreview.customers.length],
              ].map(([label, value]) => (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4" key={label as string}>
                  <p className="text-sm text-slate-400">{label as string}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value as number}</p>
                </div>
              ))}
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
