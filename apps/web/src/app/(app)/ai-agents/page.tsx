"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Power, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { AiAgent } from "@/lib/types";

const emptyForm = {
  name: "",
  description: "",
  provider: "OPENAI",
  model: "gpt-4.1-mini",
  systemPrompt: "",
};

export default function AiAgentsPage() {
  const { token } = useAuth();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadAgents() {
    if (!token) return;
    setAgents(await api.get<AiAgent[]>("/ai-agents", token));
  }

  useEffect(() => {
    loadAgents().catch((err) =>
      setError(err instanceof Error ? err.message : "Erro ao carregar agentes."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setLoading(true);
    setError("");
    try {
      await api.post(
        "/ai-agents",
        {
          ...form,
          provider: form.provider as AiAgent["provider"],
          temperature: 0.3,
          maxTokens: 900,
        },
        token,
      );
      setForm(emptyForm);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar agente.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAgent(id: string) {
    if (!token) return;
    await api.patch(`/ai-agents/${id}/toggle`, {}, token);
    await loadAgents();
  }

  async function removeAgent(id: string) {
    if (!token || !confirm("Excluir este agente?")) return;
    await api.delete(`/ai-agents/${id}`, token);
    await loadAgents();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Agentes IA</h1>
        <p className="mt-1 text-slate-400">
          Configure prompts, modelo e disponibilidade dos assistentes virtuais.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Novo agente</CardTitle>
            <p className="text-sm text-slate-400">
              Crie um agente para suporte, vendas ou cobranca.
            </p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descricao</Label>
                <Input
                  id="description"
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="provider">Provedor</Label>
                  <select
                    className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none"
                    id="provider"
                    value={form.provider}
                    onChange={(event) =>
                      setForm({ ...form, provider: event.target.value })
                    }
                  >
                    <option value="OPENAI">OpenAI</option>
                    <option value="CLAUDE">Claude</option>
                    <option value="GEMINI">Gemini</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Modelo</Label>
                  <Input
                    id="model"
                    value={form.model}
                    onChange={(event) => setForm({ ...form, model: event.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">Prompt do sistema</Label>
                <Textarea
                  id="systemPrompt"
                  value={form.systemPrompt}
                  onChange={(event) =>
                    setForm({ ...form, systemPrompt: event.target.value })
                  }
                  placeholder="Defina comportamento, tom de voz e limites do agente."
                  required
                />
              </div>
              <Button className="w-full" disabled={loading} type="submit">
                <Plus size={17} />
                Criar agente
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="text-emerald-300" size={19} />
                      {agent.name}
                    </CardTitle>
                    <p className="mt-1 text-sm text-slate-400">{agent.description}</p>
                  </div>
                  <Badge variant={agent.status === "ACTIVE" ? "green" : "slate"}>
                    {agent.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-slate-500">Provedor</p>
                    <p className="font-semibold text-white">{agent.provider}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-slate-500">Modelo</p>
                    <p className="font-semibold text-white">{agent.model}</p>
                  </div>
                </div>
                <p className="line-clamp-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                  {agent.systemPrompt}
                </p>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    type="button"
                    variant="secondary"
                    onClick={() => toggleAgent(agent.id)}
                  >
                    <Power size={16} />
                    {agent.status === "ACTIVE" ? "Desativar" : "Ativar"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => removeAgent(agent.id)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
