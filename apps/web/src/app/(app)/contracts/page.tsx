"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Contract, PaginatedResponse } from "@/lib/types";

export default function ContractsPage() {
  const { token } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!token) return;
    api
      .get<PaginatedResponse<Contract>>(`/contracts?page=${page}&limit=100`, token)
      .then((response) => {
        setContracts(response.data);
        setTotal(response.total);
        setTotalPages(response.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar contratos."));
  }, [token, page]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Contratos</h1>
        <p className="mt-1 text-slate-400">Contratos sincronizados do SGP.</p>
      </div>

      {error ? <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="text-emerald-300" size={20} />
            Base de contratos
          </CardTitle>
          <p className="text-sm text-slate-400">
            {total} registros · página {page} de {totalPages}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {contracts.map((contract) => (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4" key={contract.id}>
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                <div>
                  <p className="font-semibold text-white">Contrato SGP {contract.externalId}</p>
                  <p className="text-sm text-slate-400">{contract.planName ?? "Plano não informado"}</p>
                  <p className="text-xs text-slate-500">Cliente: {contract.customerId}</p>
                </div>
                <Badge variant={contract.status === "ACTIVE" ? "green" : contract.status === "SUSPENDED" ? "amber" : "slate"}>
                  {contract.status}
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
