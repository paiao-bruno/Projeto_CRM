"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, Send, UserRound } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadConversations() {
    if (!token) return;
    const data = await api.get<Conversation[]>("/chat/conversations", token);
    setConversations(data);
    if (!selectedId && data[0]) {
      setSelectedId(data[0].id);
    }
  }

  async function loadConversation(id: string) {
    if (!token) return;
    const data = await api.get<Conversation>(`/chat/conversations/${id}`, token);
    setSelected(data);
  }

  useEffect(() => {
    loadConversations().catch((err) =>
      setError(err instanceof Error ? err.message : "Erro ao carregar conversas."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedId) return;
    loadConversation(selectedId).catch((err) =>
      setError(err instanceof Error ? err.message : "Erro ao carregar historico."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selected || !message.trim()) return;

    await api.post(`/chat/conversations/${selected.id}/messages`, { body: message }, token);
    setMessage("");
    await Promise.all([loadConversations(), loadConversation(selected.id)]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Chat</h1>
        <p className="mt-1 text-slate-400">
          Atendimento manual, historico completo e transferencia entre humano e IA.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl bg-red-500/10 p-4 text-red-200">{error}</div>
      ) : null}

      <section className="grid min-h-[680px] gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-800 p-4">
            <p className="font-semibold text-white">Conversas</p>
            <p className="text-sm text-slate-500">{conversations.length} em atendimento</p>
          </div>
          <div className="divide-y divide-slate-800">
            {conversations.map((conversation) => (
              <button
                className={cn(
                  "w-full p-4 text-left transition hover:bg-slate-900/60",
                  selectedId === conversation.id && "bg-emerald-400/10",
                )}
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {conversation.customer?.name ?? "Cliente sem cadastro"}
                    </p>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-400">
                      {conversation.messages[0]?.body ?? conversation.subject}
                    </p>
                  </div>
                  <Badge variant={conversation.priority === "HIGH" ? "amber" : "blue"}>
                    {conversation.status}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-800 p-4">
                <div>
                  <p className="font-semibold text-white">
                    {selected.customer?.name ?? selected.subject}
                  </p>
                  <p className="text-sm text-slate-500">
                    Agente ativo: {selected.activeAiAgent?.name ?? "Atendimento manual"}
                  </p>
                </div>
                <Badge variant="green">Manual + IA</Badge>
              </div>

              <CardContent className="flex-1 space-y-4 overflow-y-auto p-5">
                {selected.messages.map((item) => {
                  const mine = item.direction === "OUTBOUND";
                  return (
                    <div className={cn("flex", mine ? "justify-end" : "justify-start")} key={item.id}>
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-4 py-3",
                          mine
                            ? "bg-emerald-400 text-slate-950"
                            : "border border-slate-800 bg-slate-950/70 text-slate-100",
                        )}
                      >
                        <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                          {item.senderType === "AI_AGENT" ? <Bot size={14} /> : <UserRound size={14} />}
                          {item.senderAiAgent?.name ??
                            item.senderMember?.user.name ??
                            item.senderCustomer?.name ??
                            item.senderType}
                        </div>
                        <p className="text-sm">{item.body}</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>

              <form className="border-t border-slate-800 p-4" onSubmit={sendMessage}>
                <div className="flex gap-3">
                  <Textarea
                    className="min-h-12"
                    placeholder="Digite sua resposta manual..."
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <Button className="self-end" type="submit">
                    <Send size={17} />
                    Enviar
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-slate-500">
              Selecione uma conversa.
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
