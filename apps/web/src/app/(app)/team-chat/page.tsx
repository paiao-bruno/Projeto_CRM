"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  Hash,
  MessageCircle,
  MoreHorizontal,
  RefreshCcw,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TeamConversation = {
  id: string;
  name: string;
  type: "private" | "group";
  lastMessage: string;
  unread: number;
  online: boolean;
};

const conversations: TeamConversation[] = [
  {
    id: "ops",
    name: "Operação NOC",
    type: "group",
    lastMessage: "Monitoramento da rota sul normalizado.",
    unread: 2,
    online: true,
  },
  {
    id: "lucca",
    name: "Lucca",
    type: "private",
    lastMessage: "Pode validar a OS do cliente Mariana?",
    unread: 0,
    online: true,
  },
];

export default function TeamChatPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMockConversations, setShowMockConversations] = useState(false);

  const visibleConversations = useMemo(() => {
    const source = showMockConversations ? conversations : [];
    return source.filter((conversation) =>
      conversation.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [search, showMockConversations]);

  const selectedConversation = visibleConversations.find(
    (conversation) => conversation.id === selectedId,
  );

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col border-b border-slate-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Hash size={21} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Team Chat</h1>
            <p className="text-sm text-slate-500">Communication between team members</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 md:mt-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowMockConversations((current) => !current)}
          >
            <RefreshCcw size={16} />
          </Button>
          <Button size="sm" variant="secondary">
            <Bell size={16} />
          </Button>
        </div>
      </div>

      <div className="grid min-h-[680px] lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-950">Conversations</p>
                <p className="text-xs text-slate-400">Team and private rooms</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowMockConversations(true)}
                  title="Iniciar nova conversa"
                >
                  <MessageCircle size={16} />
                </Button>
                <Button size="sm" variant="ghost" title="Gerenciar contatos">
                  <UserPlus size={16} />
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <Input
                className="border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:ring-violet-200"
                placeholder="Search..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="min-h-[420px] p-4">
            {visibleConversations.length ? (
              <div className="space-y-2">
                {visibleConversations.map((conversation) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                      selectedId === conversation.id
                        ? "border-violet-200 bg-violet-50"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    )}
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                    type="button"
                  >
                    <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                      {conversation.type === "group" ? <Users size={18} /> : <Hash size={18} />}
                      {conversation.online ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-slate-950">{conversation.name}</p>
                        {conversation.unread ? <Badge variant="green">{conversation.unread}</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-slate-400">{conversation.lastMessage}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                <MessageCircle className="mb-3 text-slate-300" size={34} />
                <p className="font-semibold text-slate-500">No conversations yet</p>
                <p className="mt-1 max-w-48 text-sm text-slate-400">
                  Start a conversation with a colleague
                </p>
              </div>
            )}
          </div>
        </aside>

        <main className="relative flex min-h-[680px] items-center justify-center bg-slate-50/70 p-6">
          {selectedConversation ? (
            <Card className="w-full max-w-3xl overflow-hidden border-slate-200 bg-white text-slate-950 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
                    {selectedConversation.type === "group" ? <Users size={19} /> : <Hash size={19} />}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-950">{selectedConversation.name}</p>
                    <p className="text-xs text-slate-400">
                      {selectedConversation.online ? "Online now" : "Offline"}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost">
                  <MoreHorizontal size={17} />
                </Button>
              </div>
              <div className="space-y-4 p-5">
                <div className="max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  {selectedConversation.lastMessage}
                </div>
                <div className="ml-auto max-w-md rounded-2xl bg-violet-500 p-4 text-sm text-white">
                  Recebido. Vou acompanhar por aqui e atualizar o time.
                </div>
              </div>
            </Card>
          ) : (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-sky-100 bg-sky-50 text-sky-400">
                <MessageCircle size={30} />
              </div>
              <p className="text-lg font-semibold text-slate-600">Select a conversation</p>
              <p className="mt-1 text-sm text-slate-400">
                Choose a conversation on the side or start a new one
              </p>
            </div>
          )}
        </main>
      </div>

      <button
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sky-500 shadow-2xl transition hover:bg-slate-50"
        type="button"
      >
        <MessageCircle size={24} />
      </button>
    </div>
  );
}
