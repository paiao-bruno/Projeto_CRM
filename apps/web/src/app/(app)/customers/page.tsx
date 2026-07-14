"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCcw, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { Customer, SgpSyncStartResponse } from "@/lib/types";

const statusVariant = {
  ACTIVE: "green",
  PROSPECT: "blue",
  OVERDUE: "amber",
  INACTIVE: "slate",
  CHURNED: "red",
} as const;

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  document: "",
  planName: "",
};

export default function CustomersPage() {
  const { token } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const filteredCustomers = useMemo(() => customers, [customers]);

  async function loadCustomers() {
    if (!token) return;
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    const data = await api.get<Customer[]>(`/customers${query}`, token);
    setCustomers(data);
  }

  useEffect(() => {
    loadCustomers().catch((err) =>
      setError(err instanceof Error ? err.message : "Erro ao carregar clientes."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError("");
    setLoading(true);

    try {
      await api.post<Customer>(
        "/customers",
        {
          ...form,
          status: "PROSPECT",
        },
        token,
      );
      setForm(emptyForm);
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar cliente.");
    } finally {
      setLoading(false);
    }
  }

  async function removeCustomer(id: string) {
    if (!token || !confirm("Excluir este cliente?")) return;
    await api.delete(`/customers/${id}`, token);
    await loadCustomers();
  }

  async function syncFromSgp() {
    if (!token) return;
    setError("");
    setSyncMessage("");
    setSyncing(true);

    try {
      const response = await api.post<SgpSyncStartResponse>(
        "/integrations/sgp/sync-customers",
        { pagination: { page: 1, limit: 100 } },
        token,
      );
      setSyncMessage(response.message);
      window.setTimeout(() => {
        loadCustomers().catch((err) =>
          setError(err instanceof Error ? err.message : "Erro ao recarregar clientes."),
        );
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao sincronizar SGP.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-3xl font-semibold text-white">Clientes</h1>
          <p className="mt-1 text-slate-400">
            Cadastro e acompanhamento comercial dos assinantes e leads.
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <Button disabled={syncing} type="button" onClick={syncFromSgp}>
            <RefreshCcw className={syncing ? "animate-spin" : ""} size={17} />
            Sincronizar SGP
          </Button>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            loadCustomers().catch((err) => setError(err.message));
          }}>
            <Input
              className="w-72"
              placeholder="Buscar cliente..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant="secondary" type="submit">
              <Search size={17} />
              Buscar
            </Button>
          </form>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>
      ) : null}
      {syncMessage ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-200">
          {syncMessage}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Novo cliente</CardTitle>
            <p className="text-sm text-slate-400">Crie um lead ou assinante no CRM.</p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              {[
                ["name", "Nome"],
                ["email", "Email"],
                ["phone", "Telefone"],
                ["document", "Documento"],
                ["planName", "Plano"],
              ].map(([key, label]) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    value={form[key as keyof typeof form]}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [key]: event.target.value }))
                    }
                    required={key === "name"}
                  />
                </div>
              ))}
              <Button className="w-full" disabled={loading} type="submit">
                <Plus size={17} />
                Adicionar cliente
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Base de clientes</CardTitle>
            <p className="text-sm text-slate-400">{filteredCustomers.length} registros</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Contato</th>
                    <th className="p-4">Plano</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr className="border-t border-slate-800" key={customer.id}>
                      <td className="p-4">
                        <p className="font-semibold text-white">{customer.name}</p>
                        <p className="text-xs text-slate-500">{customer.document}</p>
                        {customer.ispAccountCode ? (
                          <Badge className="mt-2" variant="blue">
                            SGP {customer.ispAccountCode}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="p-4 text-slate-300">
                        <p>{customer.email}</p>
                        <p className="text-xs text-slate-500">{customer.phone}</p>
                      </td>
                      <td className="p-4 text-slate-300">{customer.planName ?? "-"}</td>
                      <td className="p-4">
                        <Badge variant={statusVariant[customer.status]}>
                          {customer.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          size="sm"
                          type="button"
                          variant="ghost"
                          onClick={() => removeCustomer(customer.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
