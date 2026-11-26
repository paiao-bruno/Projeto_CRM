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
  selectedApp?: string | null;
  selectedIntegrationId?: string | null;
  selectedDedicated?: boolean;
  storedRows?: number;
  decryptableRows?: number;
  encryptionReady?: boolean;
};

export function SgpChurnSettings() {
  const { token } = useAuth();
  const { data, error, reload } = useResource<PublicCreds>("/dashboard/churn/credentials");
  const [apiUrl, setApiUrl] = useState("");
  const [app, setApp] = useState("");
  const [sgpToken, setSgpToken] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState("");
  const stored = data?.storedRows ?? 0;
  const decryptable = data?.decryptableRows ?? 0;
  const cannotDecrypt = stored > 0 && decryptable === 0;

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
      <ol className="list-decimal space-y-1 pl-5 text-sm vx-muted">
        <li>No SGP: Administração → Integrações → Tokens. Crie ou ative um token com permissão de leitura de clientes.</li>
        <li>
          Copie o campo <strong>App</strong> e o <strong>Token</strong> gerados pelo SGP. Não use e-mail nem senha do CRM.
        </li>
        <li>
          URL da API: origem HTTPS do SGP (exemplo <code>https://webmais.sgp.net.br</code>), sem caminho extra.
        </li>
        <li>
          No servidor do Next, o <code>.env</code> precisa de <code>APP_ENCRYPTION_KEY</code> (cifra nova) e, se o token
          já existia no Nest, o mesmo <code>ENCRYPTION_KEY</code> de 32+ caracteres.
        </li>
        <li>Grave aqui uma vez. A autenticação usa POST <code>/api/ura/clientes/</code> com App e Token no corpo.</li>
      </ol>
      <p className="text-xs vx-muted">
        {data?.tokenConfigured
          ? `Em uso: App ${data.selectedApp ?? "(não exposto)"} · ${data.selectedDedicated ? "leitura de cancelamentos" : "integração SGP original"} · ${data.apiHost ?? "sem host"}${stored > 1 ? ` · ${stored} registros SGP neste tenant` : ""}.`
          : cannotDecrypt
            ? data?.encryptionReady
              ? "Há integração SGP salva, mas o App/Token não puderam ser lidos com as chaves atuais. Regrave App e Token neste formulário."
              : "Há integração SGP salva, mas o processo Next não tem APP_ENCRYPTION_KEY nem ENCRYPTION_KEY. Sem a chave o token não é lido."
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
