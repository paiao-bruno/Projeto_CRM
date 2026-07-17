"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
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
  const [credentials, setCredentials] = useState<SgpCredentials[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>("");
  const [form, setForm] = useState<CredentialFormState>(emptyForm);
  const [isCreating, setIsCreating] = useState(true);

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

  useEffect(() => {
    void loadCredentials().catch((err) => {
      setError(err instanceof Error ? err.message : "Erro ao carregar credenciais SGP.");
    });
  }, [loadCredentials]);

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
        <MetricCard icon={Plug} title="Total Integrations" value={credentials.length || 1} hint="SGP API" />
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
              <Badge
                variant={
                  currentRun.status === "COMPLETED"
                    ? "green"
                    : currentRun.status === "FAILED"
                      ? "red"
                      : currentRun.status === "PARTIAL"
                        ? "amber"
                        : "blue"
                }
              >
                {currentRun.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              {[
                ["Processados", currentRun.processed],
                ["Criados", currentRun.created],
                ["Atualizados", currentRun.updated],
                ["Ignorados", currentRun.ignored],
                ["Erros", currentRun.errorsCount],
              ].map(([label, value]) => (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4" key={label as string}>
                  <p className="text-sm text-slate-400">{label as string}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{value as number}</p>
                </div>
              ))}
            </div>
            {currentRun.errorMessage ? (
              <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">
                {currentRun.errorMessage}
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
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div className="flex items-center gap-4">
                <span className="rounded-2xl bg-sky-400/10 p-3 text-sky-300">
                  <Server size={24} />
                </span>
                <div>
                  <CardTitle>SGP</CardTitle>
                  <p className="mt-1 text-sm text-slate-400">
                    Integração oficial via /api/ura/clientes/
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
