"use client";

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { isWebOnlyMode, LEGACY_API_UNAVAILABLE_MESSAGE } from "@/lib/runtime-config";
import { Invoice, PaginatedResponse } from "@/lib/types";

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!token) return;
    if (isWebOnlyMode()) {
      setError(LEGACY_API_UNAVAILABLE_MESSAGE);
      return;
    }
    api
      .get<PaginatedResponse<Invoice>>(`/invoices?page=${page}&limit=100`, token)
      .then((response) => {
        setInvoices(response.data);
        setTotal(response.total);
        setTotalPages(response.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar faturas."));
  }, [token, page]);

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
          <p className="text-sm text-slate-400">
            {total} registros · página {page} de {totalPages}
          </p>
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
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <Button
              disabled={page <= 1}
              type="button"
              variant="secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <select
              className="h-10 rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: totalPages }).map((_, index) => (
                <option key={index + 1} value={index + 1}>
                  Página {index + 1}
                </option>
              ))}
            </select>
            <Button
              disabled={page >= totalPages}
              type="button"
              variant="secondary"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Próxima
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
