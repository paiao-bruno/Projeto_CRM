"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  Camera,
  Hash,
  Image,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  PauseCircle,
  RefreshCcw,
  Search,
  Settings,
  Smile,
  UserPlus,
  Users,
  Video,
  Volume2,
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

const floatingTools = [
  { icon: Paperclip, label: "Anexar arquivo" },
  { icon: Camera, label: "Câmera" },
  { icon: Video, label: "Gravar vídeo" },
  { label: "04:45", timer: true },
  { icon: PauseCircle, label: "Pausar gravação" },
  { icon: Mic, label: "Microfone" },
  { icon: Volume2, label: "Volume" },
  { icon: Smile, label: "Emoji" },
  { icon: Image, label: "Galeria" },
  { icon: Settings, label: "Configurações" },
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
    <div className="relative min-h-[calc(100vh-8rem)] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/40">
      <div className="flex flex-col border-b border-slate-800 bg-slate-950/70 px-4 py-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300">
            <Hash size={21} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-white">Team Chat</h1>
            <p className="text-sm text-slate-400">Communication between team members</p>
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
        <aside className="border-b border-slate-800 bg-slate-950/35 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-800 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Conversations</p>
                <p className="text-xs text-slate-500">Team and private rooms</p>
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
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                size={16}
              />
              <Input
                className="pl-9"
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
                        ? "border-emerald-400/30 bg-emerald-400/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700",
                    )}
                    key={conversation.id}
                    onClick={() => setSelectedId(conversation.id)}
                    type="button"
                  >
                    <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 text-slate-300">
                      {conversation.type === "group" ? <Users size={18} /> : <Hash size={18} />}
                      {conversation.online ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-white">{conversation.name}</p>
                        {conversation.unread ? <Badge variant="green">{conversation.unread}</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-slate-500">{conversation.lastMessage}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                <MessageCircle className="mb-3 text-slate-600" size={34} />
                <p className="font-semibold text-slate-300">No conversations yet</p>
                <p className="mt-1 max-w-48 text-sm text-slate-500">
                  Start a conversation with a colleague
                </p>
              </div>
            )}
          </div>
        </aside>

        <main className="relative flex min-h-[680px] items-center justify-center bg-slate-950/20 p-6">
          {selectedConversation ? (
            <Card className="w-full max-w-3xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
                    {selectedConversation.type === "group" ? <Users size={19} /> : <Hash size={19} />}
                  </span>
                  <div>
                    <p className="font-semibold text-white">{selectedConversation.name}</p>
                    <p className="text-xs text-slate-500">
                      {selectedConversation.online ? "Online now" : "Offline"}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost">
                  <MoreHorizontal size={17} />
                </Button>
              </div>
              <div className="space-y-4 p-5">
                <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                  {selectedConversation.lastMessage}
                </div>
                <div className="ml-auto max-w-md rounded-2xl bg-emerald-400 p-4 text-sm text-slate-950">
                  Recebido. Vou acompanhar por aqui e atualizar o time.
                </div>
              </div>
            </Card>
          ) : (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                <MessageCircle size={30} />
              </div>
              <p className="text-lg font-semibold text-white">Select a conversation</p>
              <p className="mt-1 text-sm text-slate-500">
                Choose a conversation on the side or start a new one
              </p>
            </div>
          )}
        </main>
      </div>

      <div className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/95 p-2 shadow-2xl lg:flex">
        {floatingTools.map((tool) => {
          if (tool.timer) {
            return (
              <span
                className="rounded-xl border border-red-400/30 bg-red-400/10 px-2 py-1 text-[10px] font-semibold text-red-200"
                key={tool.label}
              >
                {tool.label}
              </span>
            );
          }
          const Icon = tool.icon;
          return (
            <button
              className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              key={tool.label}
              title={tool.label}
              type="button"
            >
              {Icon ? <Icon size={16} /> : null}
            </button>
          );
        })}
      </div>

      <button
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-emerald-300 shadow-2xl transition hover:bg-slate-900"
        type="button"
      >
        <MessageCircle size={24} />
      </button>
    </div>
  );
}
