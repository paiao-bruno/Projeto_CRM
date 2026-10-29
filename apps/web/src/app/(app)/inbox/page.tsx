"use client";

import { Check, Lock, RefreshCw, Search, Send, UserPlus } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { RealtimeState, connectRealtime } from "@/lib/realtime-client";
import {
  ConversationDetail,
  deliveryLabel,
  InboxList,
  InboxTab,
  TeamMember,
  formatPhone,
  inboxApi,
} from "@/lib/inbox-client";

const POLL_MS = 5000;

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Aberta",
  PENDING: "Pendente",
  SOLVED: "Encerrada",
  ARCHIVED: "Arquivada",
};

const PRESENCE_LABEL = { ONLINE: "online", AWAY: "ausente", OFFLINE: "offline" } as const;

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Conversa criada",
  CLAIMED: "Atendimento assumido",
  TRANSFERRED: "Conversa transferida",
  CLOSED: "Conversa encerrada",
  REOPENED: "Conversa reaberta",
};

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function InboxPage() {
  const { token, user } = useAuth();
  const [tab, setTab] = useState<InboxTab>("queue");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<InboxList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");

  const refreshList = useCallback(async () => {
    if (!token) return;
    try {
      setList(await inboxApi.list(token, { tab, search: search.trim() || undefined }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar conversas.");
    }
  }, [token, tab, search]);

  const refreshDetail = useCallback(async () => {
    if (!token || !selectedId) return;
    try {
      setDetail(await inboxApi.detail(token, selectedId));
    } catch {
      setDetail(null);
      setSelectedId(null);
    }
  }, [token, selectedId]);

  const refreshRef = useRef({ list: refreshList, detail: refreshDetail });
  refreshRef.current = { list: refreshList, detail: refreshDetail };
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  useEffect(() => {
    if (!token) return;
    return connectRealtime({
      token,
      onState: setRealtime,
      onResync: () => void Promise.all([refreshRef.current.list(), refreshRef.current.detail()]),
      onChange: (change) => {
        void refreshRef.current.list();
        if (!change.conversationId || change.conversationId === selectedRef.current) void refreshRef.current.detail();
      },
    });
  }, [token]);

  useEffect(() => {
    if (realtime !== "polling") return;
    const timer = setInterval(() => {
      void refreshRef.current.list();
      void refreshRef.current.detail();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [realtime]);

  useEffect(() => {
    if (!token) return;
    void inboxApi.members(token).then(setMembers).catch(() => undefined);
    void inboxApi.capabilities(token).then((c) => setDemoEnabled(c.demoInbound)).catch(() => undefined);
  }, [token]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha na operacao.");
    } finally {
      await Promise.all([refreshList(), refreshDetail()]);
      setBusy(false);
    }
  }

  const isSupervisor = list?.counts.all !== null && list?.counts.all !== undefined;
  const tabs: Array<{ key: InboxTab; label: string; count?: number | null }> = [
    { key: "queue", label: "Fila", count: list?.counts.queue },
    { key: "mine", label: "Meus", count: list?.counts.mine },
    ...(isSupervisor ? [{ key: "all" as InboxTab, label: "Todos", count: list?.counts.all }] : []),
    { key: "closed", label: "Encerradas", count: list?.counts.closed },
  ];

  return (
    <div className="grid h-[calc(100vh-140px)] min-h-[480px] gap-4 lg:grid-cols-[340px_1fr]">
      <section className="vx-card flex min-h-0 flex-col overflow-hidden" aria-label="Lista de conversas">
        <div className="space-y-3 border-b p-3" style={{ borderColor: "var(--vx-border)" }}>
          <div role="tablist" className="flex flex-wrap gap-1">
            {tabs.map((item) => (
              <button
                key={item.key}
                role="tab"
                aria-selected={tab === item.key}
                className="vx-tab"
                onClick={() => setTab(item.key)}
                type="button"
              >
                {item.label}
                {typeof item.count === "number" ? ` (${item.count})` : ""}
              </button>
            ))}
          </div>
          <label className="relative block">
            <Search size={15} className="absolute left-3 top-3 vx-muted" />
            <input
              className="vx-input"
              style={{ paddingLeft: 34 }}
              placeholder="Buscar por nome, telefone ou protocolo"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar conversas"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {list && list.items.length === 0 ? (
            <p className="p-6 text-center text-sm vx-muted">Nenhuma conversa nesta aba.</p>
          ) : null}
          {list?.items.map((item) => (
            <button
              key={item.id}
              className="vx-row"
              aria-current={item.id === selectedId}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{item.customer?.name ?? "Contato sem nome"}</span>
                <span className="shrink-0 text-xs vx-muted">{formatTime(item.lastMessageAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs vx-muted">{item.lastMessage?.preview ?? "Sem mensagens"}</span>
                {item.unreadCount > 0 ? <span className="vx-badge vx-badge-coral">{item.unreadCount}</span> : null}
              </div>
              <div className="mt-1 flex gap-2 text-[11px] vx-muted">
                <span>#{item.protocol}</span>
                <span>{item.assignee ? `com ${item.assignee.name}` : "sem responsável"}</span>
              </div>
            </button>
          ))}
        </div>
        {demoEnabled && isSupervisor ? <DemoInbound token={token!} onSent={() => void refreshList()} /> : null}
      </section>

      <section className="vx-card flex min-h-0 flex-col overflow-hidden" aria-label="Conversa">
        <p className="border-b px-3 py-1 text-[11px] vx-muted" style={{ borderColor: "var(--vx-border)" }} data-testid="realtime-state">
          {realtime === "live" ? "Tempo real conectado" : realtime === "polling" ? "Tempo real indisponível: atualizando por consulta periódica" : "Conectando ao tempo real..."}
        </p>
        {error ? <div className="vx-alert vx-alert-error m-3" role="alert">{error}</div> : null}
        {!detail ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm vx-muted">
            Selecione uma conversa para atender.
          </div>
        ) : (
          <ConversationPanel
            key={detail.id}
            busy={busy}
            detail={detail}
            members={members.filter((m) => m.id !== detail.assignee?.id)}
            meId={user?.memberId ?? ""}
            onClaim={() => act(() => inboxApi.claim(token!, detail.id))}
            onClose={() => act(() => inboxApi.close(token!, detail.id, detail.version))}
            onReopen={() => act(() => inboxApi.reopen(token!, detail.id, detail.version))}
            onRead={() => void inboxApi.markRead(token!, detail.id).then(refreshList).catch(() => undefined)}
            onReply={(body, internal) =>
              act(() => inboxApi.reply(token!, detail.id, body, internal, crypto.randomUUID()))
            }
            onResolve={(messageId, action) => act(() => inboxApi.resolveDelivery(token!, detail.id, messageId, action))}
            onTransfer={(memberId) =>
              act(async () => {
                const result = await inboxApi.transfer(token!, detail.id, memberId, detail.version);
                if (!result.stillVisible) {
                  setSelectedId(null);
                  setDetail(null);
                }
              })
            }
          />
        )}
      </section>
    </div>
  );
}

function ConversationPanel(props: {
  detail: ConversationDetail;
  members: TeamMember[];
  meId: string;
  busy: boolean;
  onClaim: () => void;
  onClose: () => void;
  onReopen: () => void;
  onRead: () => void;
  onReply: (body: string, internal: boolean) => Promise<void> | void;
  onTransfer: (memberId: string) => void;
  onResolve: (messageId: string, action: "retry" | "mark_failed") => void;
}) {
  const { detail, members, busy } = props;
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [target, setTarget] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const mine = detail.assignee?.id === props.meId;
  const timeline = useMemo(
    () =>
      [
        ...detail.messages.map((m) => ({ kind: "message" as const, at: m.createdAt, m })),
        ...detail.events.map((e) => ({ kind: "event" as const, at: e.createdAt, e })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [detail.messages, detail.events],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [timeline.length]);

  useEffect(() => {
    if (mine && detail.unreadCount > 0) props.onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, detail.unreadCount]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    await props.onReply(body, internal);
    setText("");
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-3" style={{ borderColor: "var(--vx-border)" }}>
        <div className="min-w-0">
          <h2 className="truncate font-bold">{detail.customer?.name ?? "Contato sem nome"}</h2>
          <p className="text-xs vx-muted">
            {formatPhone(detail.customer?.phone)} · #{detail.protocol} ·{" "}
            <span className="vx-badge vx-badge-gray">{STATUS_LABEL[detail.status]}</span>{" "}
            {detail.assignee ? `· com ${detail.assignee.name}` : "· aguardando atendimento"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {detail.can.claim ? (
            <button className="vx-btn vx-btn-primary" disabled={busy} onClick={props.onClaim} type="button">
              <UserPlus size={15} /> Assumir
            </button>
          ) : null}
          {detail.can.transfer && members.length > 0 ? (
            <span className="flex items-center gap-1">
              <select
                className="vx-input"
                style={{ width: 190 }}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                aria-label="Transferir para"
              >
                <option value="">Transferir para...</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({PRESENCE_LABEL[m.presence]})
                  </option>
                ))}
              </select>
              <button
                className="vx-btn"
                disabled={busy || !target}
                onClick={() => {
                  props.onTransfer(target);
                  setTarget("");
                }}
                type="button"
              >
                Transferir
              </button>
            </span>
          ) : null}
          {detail.can.close ? (
            <button className="vx-btn" disabled={busy} onClick={props.onClose} type="button">
              <Check size={15} /> Encerrar
            </button>
          ) : null}
          {detail.can.reopen ? (
            <button className="vx-btn" disabled={busy} onClick={props.onReopen} type="button">
              <RefreshCw size={15} /> Reabrir
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4">
        {timeline.map((entry) =>
          entry.kind === "event" ? (
            <p key={`e-${entry.e.id}`} className="self-center text-xs vx-muted">
              {EVENT_LABEL[entry.e.type] ?? entry.e.type} · {formatTime(entry.at)}
            </p>
          ) : (
            <div
              key={`m-${entry.m.id}`}
              className={`vx-bubble ${
                entry.m.direction === "INBOUND" ? "vx-bubble-in" : entry.m.direction === "INTERNAL" ? "vx-bubble-note" : "vx-bubble-out"
              }`}
            >
              {entry.m.direction === "INTERNAL" ? <strong className="mb-1 flex items-center gap-1 text-xs"><Lock size={11} /> Nota interna</strong> : null}
              {entry.m.body}
              <div className="mt-1 text-right text-[10px] opacity-70">
                {formatTime(entry.at)}
                {(() => {
                  const label = deliveryLabel(entry.m);
                  return label ? <span data-delivery={entry.m.delivery?.status ?? "RECORDED_ONLY"}> · {label.text}</span> : null;
                })()}
              </div>
              {entry.m.delivery?.status === "UNKNOWN" && detail.can.reply ? (
                <div className="mt-1 flex flex-wrap justify-end gap-1">
                  <button className="vx-btn" style={{ height: 26, fontSize: 12 }} disabled={busy} onClick={() => props.onResolve(entry.m.id, "retry")} type="button">Reenviar (pode duplicar)</button>
                  <button className="vx-btn" style={{ height: 26, fontSize: 12 }} disabled={busy} onClick={() => props.onResolve(entry.m.id, "mark_failed")} type="button">Marcar como não enviada</button>
                </div>
              ) : null}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {detail.can.reply ? (
        <form className="space-y-2 border-t p-3" style={{ borderColor: "var(--vx-border)" }} onSubmit={submit}>
          <textarea
            className="vx-input"
            rows={2}
            value={text}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            placeholder={internal ? "Nota interna (nao e enviada ao cliente)" : "Escreva a resposta"}
            aria-label="Mensagem"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Nota interna
            </label>
            <button className="vx-btn vx-btn-primary" disabled={busy || !text.trim()} type="submit">
              <Send size={15} /> {internal ? "Salvar nota" : "Registrar resposta"}
            </button>
          </div>
        </form>
      ) : (
        <p className="border-t p-3 text-sm vx-muted" style={{ borderColor: "var(--vx-border)" }}>
          {detail.status === "SOLVED"
            ? "Conversa encerrada."
            : detail.can.claim
              ? "Assuma a conversa para responder."
              : "Somente quem atende pode responder."}
        </p>
      )}
    </>
  );
}

function DemoInbound({ token, onSent }: { token: string; onSent: () => void }) {
  const [name, setName] = useState("Cliente Sintético");
  const [phone, setPhone] = useState("+55 11 90000-0001");
  const [text, setText] = useState("Olá, preciso de ajuda com minha conexão.");
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channels, setChannels] = useState<Array<{ id: string; name: string; status: string }>>([]);

  useEffect(() => {
    void api.get<Array<{ id: string; name: string; status: string }>>("/channels", token).then(setChannels).catch(() => setChannels([]));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      await inboxApi.demoInbound(token, { contactName: name, contactPhone: phone, text, channelId: channelId || undefined });
      setState("ok");
      setMessage("Evento sintético recebido.");
      onSent();
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "Falha.");
    }
  }

  return (
    <form className="space-y-2 border-t p-3" style={{ borderColor: "var(--vx-border)", background: "#FFF8F5" }} onSubmit={submit}>
      <p className="text-xs font-bold" style={{ color: "#B4472B" }}>
        Simulador de entrada (somente desenvolvimento; nenhum canal real)
      </p>
      <input className="vx-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do contato simulado" />
      <input className="vx-input" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Telefone do contato simulado" />
      <textarea className="vx-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto simulado" />
      {channels.length > 0 ? (
        <select className="vx-input" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Canal da conversa simulada">
          <option value="">Sem canal (respostas só registradas)</option>
          {channels.filter((c) => c.status === "ACTIVE").map((c) => <option key={c.id} value={c.id}>Canal de teste: {c.name}</option>)}
        </select>
      ) : null}
      <button className="vx-btn vx-btn-accent w-full" disabled={state === "sending"} type="submit">
        Simular mensagem recebida
      </button>
      {state === "ok" || state === "error" ? (
        <p className={`text-xs ${state === "error" ? "" : "vx-muted"}`} style={state === "error" ? { color: "var(--vx-danger)" } : undefined} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
