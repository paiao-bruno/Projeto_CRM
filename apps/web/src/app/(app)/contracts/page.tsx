"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Contract } from "@/lib/types";

export default function ContractsPage() {
  const { token } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api
      .get<Contract[]>("/contracts", token)
      .then(setContracts)
      .catch((err) => setError(err instanceof Error ? err.message : "Erro ao carregar contratos."));
  }, [token]);

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
          <p className="text-sm text-slate-400">{contracts.length} registros</p>
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
        </CardContent>
      </Card>
    </div>
  );
}
