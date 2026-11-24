"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { ErrorAlert, Field, useResource } from "@/components/vx";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";

type PublicCreds = {
  configured: boolean;
  tokenConfigured: boolean;
  apiHost: string | null;
};

export function SgpChurnSettings() {
  const { token } = useAuth();
  const { data, error, reload } = useResource<PublicCreds>("/dashboard/churn/credentials");
  const [apiUrl, setApiUrl] = useState("");
  const [app, setApp] = useState("");
  const [sgpToken, setSgpToken] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setFormError("");
    setSaved("");
    try {
      await api.patch(
        "/dashboard/churn/credentials",
        { apiUrl: apiUrl || (data?.apiHost ? `https://${data.apiHost}` : ""), app, token: sgpToken },
        token,
      );
      setSgpToken("");
      setSaved("Configuração gravada no servidor. A validação e a sincronização iniciam automaticamente.");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao gravar a leitura SGP.");
    }
  }

  return (
    <section className="vx-card mb-4 space-y-3 p-4">
      <h2 className="font-bold">Leitura SGP (cancelamentos)</h2>
      <p className="text-sm vx-muted">
        Provisionamento único no servidor. O Dashboard reutiliza esta configuração; não preencha a aba a cada acesso.
        Token já gravado permanece se o campo ficar vazio. A máscara nunca é o segredo.
      </p>
      <p className="text-xs vx-muted">
        {data?.tokenConfigured
          ? `Token configurado${data.apiHost ? ` · host ${data.apiHost}` : ""}.`
          : "Ainda não há App/Token recuperáveis neste tenant."}
      </p>
      <ErrorAlert message={error || formError || null} />
      {saved ? <p className="text-sm">{saved}</p> : null}
      <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
        <Field label="URL da API">
          <input
            className="vx-input"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            placeholder={data?.apiHost ? `https://${data.apiHost}` : "https://webmais.sgp.net.br"}
          />
        </Field>
        <Field label="App">
          <input className="vx-input" value={app} onChange={(event) => setApp(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Token">
          <input
            className="vx-input"
            type="password"
            value={sgpToken}
            onChange={(event) => setSgpToken(event.target.value)}
            placeholder={data?.tokenConfigured ? "•••••• (já gravado)" : ""}
            autoComplete="off"
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit">Gravar leitura SGP</Button>
        </div>
      </form>
    </section>
  );
}
