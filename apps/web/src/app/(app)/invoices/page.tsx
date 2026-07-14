"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Invoice } from "@/lib/types";

function formatCurrency(cents?: number | null) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format((cents ?? 0) / 100);
}

export default function InvoicesPage() {
  const { token } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api
      .get<Invoice[]>("/invoices", token)
      .then(setInvoices)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar faturas."));
  }, [token]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Faturas</h1>
        <p className="mt-1 text-slate-400">Títulos e faturas sincronizados do SGP.</p>
      </div>

      {error ? <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="text-emerald-300" size={20} />
            Base financeira
          </CardTitle>
          <p className="text-sm text-slate-400">{invoices.length} registros</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {invoices.map((invoice) => (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4" key={invoice.id}>
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <p className="font-semibold text-white">Fatura SGP {invoice.externalId}</p>
                  <p className="text-sm text-slate-400">{formatCurrency(invoice.amountCents)}</p>
                  <p className="text-xs text-slate-500">
                    Vencimento: {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("pt-BR") : "-"}
                  </p>
                </div>
                <Badge variant={invoice.status === "PAID" ? "green" : invoice.status === "OVERDUE" ? "red" : "amber"}>
                  {invoice.status}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
