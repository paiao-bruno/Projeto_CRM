"use client";

import { useState } from "react";
import { Activity, CheckCircle2, Database, Plug, RefreshCcw, Search, Server } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { SgpDiscoveryPreview, SgpSyncStartResponse } from "@/lib/types";

type ConnectionState = "idle" | "online" | "error";

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

export default function IntegrationsPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [loadingAction, setLoadingAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastPreview, setLastPreview] = useState<SgpDiscoveryPreview | null>(null);

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

  async function testSgp() {
    if (!token) return;
    await runAction("test", async () => {
      await api.post<unknown>("/integrations/sgp/test-auth", { payload: {} }, token);
      setConnectionState("online");
      setMessage("Conexão SGP validada com sucesso.");
    });
  }

  async function discoverCustomers() {
    if (!token) return;
    await runAction("discover", async () => {
      const result = await api.post<SgpDiscoveryPreview>(
        "/integrations/sgp/discover/customers",
        { pagination: { page: 1, limit: 25 } },
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
        { pagination: { page: 1, limit: 100 } },
        token,
      );
      setConnectionState("online");
      setMessage(result.message);
    });
  }

  const visible = "sgp".includes(search.toLowerCase()) || "api externa".includes(search.toLowerCase());

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
        <MetricCard icon={Plug} title="Total Integrations" value={1} hint="SGP API" />
        <MetricCard icon={CheckCircle2} title="Active Integrations" value={connectionState === "online" ? 1 : 0} hint={connectionState === "online" ? "online" : "pending test"} />
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
                <Button disabled={Boolean(loadingAction)} variant="secondary" onClick={testSgp}>
                  <Search size={16} />
                  Test Connection
                </Button>
                <Button disabled={Boolean(loadingAction)} variant="secondary" onClick={discoverCustomers}>
                  <Activity size={16} />
                  Discover
                </Button>
                <Button disabled={Boolean(loadingAction)} onClick={syncCustomers}>
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
