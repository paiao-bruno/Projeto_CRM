"use client";

import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
import { ErrorAlert, Field, Modal, PageHeader, useResource } from "@/components/vx";

type Member = {
  id: string; displayName: string; email: string; status: string; presence: string;
  role: { id: string; name: string } | null; maxActiveConversations: number | null;
  sectors: { id: string; name: string }[];
};
type Role = { id: string; name: string; permissions: string[] };
type Sector = { id: string; name: string; color: string; active: boolean; members: { id: string; name: string }[]; requireCloseReason: boolean; timezone: string };
type Rule = { id: string; name: string; active: boolean; cycleNumber: number; sector: { id: string; name: string }; fallbackSector: { id: string; name: string } | null; participants: { memberId: string; name: string; percent: number; assignedInCycle: number }[] };
type Paged<T> = { data: T[]; total: number };

export default function TeamPage() {
  const [tab, setTab] = useState<"people" | "sectors" | "rules">("people");
  const membersRes = useResource<Paged<Member>>("/team/members?limit=100");
  const rolesRes = useResource<Role[]>("/team/roles");
  const sectorsRes = useResource<Sector[]>("/team/sectors");
  const rulesRes = useResource<Rule[]>("/team/round-robin");
  const token = membersRes.token;
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<{ name: string; email: string; password: string; roleId: string } | null>(null);
  const [sector, setSector] = useState<{ name: string } | null>(null);
  const [rule, setRule] = useState<{ name: string; sectorId: string; percents: Record<string, string> } | null>(null);

  const roles = rolesRes.data ?? [];
  const members = membersRes.data?.data ?? [];
  const sectors = sectorsRes.data ?? [];

  async function submitPerson(event: FormEvent) {
    event.preventDefault();
    if (!token || !person) return;
    setError(null);
    try {
      await api.post("/team/members", person, token);
      setPerson(null);
      await membersRes.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha"); }
  }
  async function submitSector(event: FormEvent) {
    event.preventDefault();
    if (!token || !sector) return;
    setError(null);
    try {
      await api.post("/team/sectors", { name: sector.name, memberIds: [] }, token);
      setSector(null);
      await sectorsRes.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha"); }
  }
  async function submitRule(event: FormEvent) {
    event.preventDefault();
    if (!token || !rule) return;
    setError(null);
    const participants = Object.entries(rule.percents)
      .filter(([, percent]) => Number(percent) > 0)
      .map(([memberId, percent]) => ({ memberId, percent: Number(percent) }));
    try {
      await api.post("/team/round-robin", { name: rule.name, sectorId: rule.sectorId, participants, active: true }, token);
      setRule(null);
      await rulesRes.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha"); }
  }

  const presenceLabel: Record<string, string> = { ONLINE: "Online", AWAY: "Ausente", OFFLINE: "Offline" };

  return (
    <div>
      <PageHeader title="Equipe e setores" subtitle="Pessoas, papéis, setores e regras de distribuição. A presença vem do servidor (não é papel de acesso)." />
      <div className="mb-4 flex gap-2">
        {([["people", "Pessoas"], ["sectors", "Setores"], ["rules", "Rodízio"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "vx-btn vx-btn-primary" : "vx-btn"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <ErrorAlert message={error ?? membersRes.error ?? sectorsRes.error ?? rulesRes.error} />

      {tab === "people" ? (
        <div>
          <button className="vx-btn vx-btn-primary mb-3" type="button" onClick={() => setPerson({ name: "", email: "", password: "", roleId: roles[0]?.id ?? "" })}>Nova pessoa</button>
          <div className="vx-card overflow-x-auto">
            <table className="vx-table">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Presença</th><th>Setores</th><th>Status</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.displayName}</td>
                    <td>{member.email}</td>
                    <td>{member.role?.name ?? "—"}</td>
                    <td>{presenceLabel[member.presence] ?? member.presence}</td>
                    <td>{member.sectors.map((s) => s.name).join(", ") || "—"}</td>
                    <td>{member.status === "ACTIVE" ? "Ativo" : "Desativado"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {members.length === 0 ? <p className="vx-empty">Nenhuma pessoa listada.</p> : null}
          </div>
        </div>
      ) : null}

      {tab === "sectors" ? (
        <div>
          <button className="vx-btn vx-btn-primary mb-3" type="button" onClick={() => setSector({ name: "" })}>Novo setor</button>
          <div className="grid gap-3 md:grid-cols-2">
            {sectors.map((item) => (
              <article key={item.id} className="vx-card p-4">
                <h2 className="font-bold" style={{ color: item.color }}>{item.name}</h2>
                <p className="text-sm vx-muted">{item.members.length} participante(s) · {item.timezone}</p>
                <p className="text-sm">{item.requireCloseReason ? "Motivo de encerramento obrigatório" : "Motivo opcional"}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "rules" ? (
        <div>
          <button className="vx-btn vx-btn-primary mb-3" type="button" onClick={() => setRule({ name: "", sectorId: sectors[0]?.id ?? "", percents: Object.fromEntries(members.map((m) => [m.id, ""])) })}>Nova regra</button>
          {(rulesRes.data ?? []).map((item) => (
            <article key={item.id} className="vx-card mb-3 p-4">
              <h2 className="font-bold">{item.name} {item.active ? "" : "(inativa)"}</h2>
              <p className="text-sm vx-muted">Setor {item.sector.name} · ciclo {item.cycleNumber}{item.fallbackSector ? ` · fallback ${item.fallbackSector.name}` : ""}</p>
              <ul className="mt-2 text-sm">{item.participants.map((p) => <li key={p.memberId}>{p.name}: {p.percent}% ({p.assignedInCycle} neste ciclo)</li>)}</ul>
            </article>
          ))}
        </div>
      ) : null}

      {person ? (
        <Modal title="Nova pessoa" onClose={() => setPerson(null)}>
          <form className="space-y-3" onSubmit={submitPerson}>
            <Field label="Nome"><input className="vx-input" required value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></Field>
            <Field label="E-mail"><input className="vx-input" type="email" required value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} /></Field>
            <Field label="Senha inicial"><input className="vx-input" type="password" required minLength={10} value={person.password} onChange={(e) => setPerson({ ...person, password: e.target.value })} /></Field>
            <Field label="Papel">
              <select className="vx-input" value={person.roleId} onChange={(e) => setPerson({ ...person, roleId: e.target.value })}>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </Field>
            <button className="vx-btn vx-btn-primary" type="submit">Criar</button>
          </form>
        </Modal>
      ) : null}
      {sector ? (
        <Modal title="Novo setor" onClose={() => setSector(null)}>
          <form className="space-y-3" onSubmit={submitSector}>
            <Field label="Nome"><input className="vx-input" required value={sector.name} onChange={(e) => setSector({ name: e.target.value })} /></Field>
            <button className="vx-btn vx-btn-primary" type="submit">Criar</button>
          </form>
        </Modal>
      ) : null}
      {rule ? (
        <Modal title="Nova regra de rodízio" onClose={() => setRule(null)}>
          <form className="space-y-3" onSubmit={submitRule}>
            <Field label="Nome"><input className="vx-input" required value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></Field>
            <Field label="Setor">
              <select className="vx-input" value={rule.sectorId} onChange={(e) => setRule({ ...rule, sectorId: e.target.value })}>
                {sectors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <p className="text-sm vx-muted">Percentuais devem somar 100. Só entram pessoas do setor (associe-as no cadastro do setor).</p>
            {members.map((member) => (
              <Field key={member.id} label={`${member.displayName} (%)`}>
                <input className="vx-input" type="number" min={0} max={100} value={rule.percents[member.id] ?? ""} onChange={(e) => setRule({ ...rule, percents: { ...rule.percents, [member.id]: e.target.value } })} />
              </Field>
            ))}
            <button className="vx-btn vx-btn-primary" type="submit">Salvar regra</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
