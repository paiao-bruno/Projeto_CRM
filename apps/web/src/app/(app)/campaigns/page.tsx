"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Megaphone,
  MousePointerClick,
  Plus,
  Send,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type CampaignStatus = "Sent" | "Scheduled" | "Drafts";

type Campaign = {
  id: string;
  name: string;
  date: string;
  channel: string;
  contacts: number;
  status: CampaignStatus;
  deliveryRate: number;
  conversionRate: number;
  sent: number;
  delivered: number;
  reads: number;
  clicks: number;
  conversions: number;
};

const initialCampaigns: Campaign[] = [
  {
    id: "upgrade-fibra",
    name: "Upgrade Fibra 1 Giga",
    date: "17/06/2026 09:00",
    channel: "WhatsApp",
    contacts: 340,
    status: "Sent",
    deliveryRate: 93,
    conversionRate: 12,
    sent: 340,
    delivered: 316,
    reads: 241,
    clicks: 78,
    conversions: 41,
  },
  {
    id: "cobranca-suave",
    name: "Lembrete de fatura",
    date: "18/06/2026 10:30",
    channel: "Email",
    contacts: 128,
    status: "Scheduled",
    deliveryRate: 0,
    conversionRate: 0,
    sent: 0,
    delivered: 0,
    reads: 0,
    clicks: 0,
    conversions: 0,
  },
  {
    id: "lead-condominios",
    name: "Condominios corporativos",
    date: "Sem agendamento",
    channel: "Telegram",
    contacts: 82,
    status: "Drafts",
    deliveryRate: 0,
    conversionRate: 0,
    sent: 0,
    delivered: 0,
    reads: 0,
    clicks: 0,
    conversions: 0,
  },
];

const tabs: CampaignStatus[] = ["Sent", "Scheduled", "Drafts"];

function MetricCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: typeof Megaphone;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-5">
        <div>
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
        </div>
        <span className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
          <Icon size={22} />
        </span>
      </CardContent>
    </Card>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [activeTab, setActiveTab] = useState<CampaignStatus>("Sent");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    channel: "WhatsApp",
    message: "",
    segment: "Clientes ativos",
    scheduleAt: "",
  });

  const metrics = useMemo(() => {
    const sent = campaigns.reduce((sum, item) => sum + item.sent, 0);
    const contacts = campaigns.reduce((sum, item) => sum + item.contacts, 0);
    const delivered = campaigns.reduce((sum, item) => sum + item.delivered, 0);
    const conversions = campaigns.reduce((sum, item) => sum + item.conversions, 0);
    return {
      total: campaigns.length,
      sent,
      contacts,
      deliveryRate: sent ? Math.round((delivered / sent) * 100) : 0,
      conversionRate: contacts ? Math.round((conversions / contacts) * 100) : 0,
      active: campaigns.filter((item) => item.status === "Scheduled").length,
    };
  }, [campaigns]);

  const visibleCampaigns = campaigns.filter((campaign) => campaign.status === activeTab);

  function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scheduled = Boolean(form.scheduleAt);
    setCampaigns((current) => [
      {
        id: crypto.randomUUID(),
        name: form.name,
        date: scheduled ? form.scheduleAt.replace("T", " ") : "Sem agendamento",
        channel: form.channel,
        contacts: form.segment === "Leads novos" ? 96 : 180,
        status: scheduled ? "Scheduled" : "Drafts",
        deliveryRate: 0,
        conversionRate: 0,
        sent: 0,
        delivered: 0,
        reads: 0,
        clicks: 0,
        conversions: 0,
      },
      ...current,
    ]);
    setForm({ name: "", channel: "WhatsApp", message: "", segment: "Clientes ativos", scheduleAt: "" });
    setActiveTab(scheduled ? "Scheduled" : "Drafts");
    setOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold text-white">Campaigns</h1>
          <p className="mt-1 text-slate-400">Manage and monitor communication campaigns.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={17} />
          New Campaign
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={Megaphone} title="Total Campaigns" value={metrics.total} />
        <MetricCard icon={Send} title="Messages Sent" value={metrics.sent} />
        <MetricCard icon={Users} title="Contacts Reached" value={metrics.contacts} />
        <MetricCard icon={CheckCircle2} title="Delivery Rate" value={`${metrics.deliveryRate}%`} />
        <MetricCard icon={TrendingUp} title="Conversion Rate" value={`${metrics.conversionRate}%`} />
        <MetricCard icon={Clock} title="Active Campaigns" value={metrics.active} />
      </section>

      <Card>
        <div className="grid grid-cols-3 gap-1 border-b border-slate-800 p-2">
          {tabs.map((tab) => (
            <button
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition",
                activeTab === tab
                  ? "bg-emerald-400 text-slate-950"
                  : "text-slate-400 hover:bg-slate-900 hover:text-white",
              )}
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === "Sent" ? <Send size={16} /> : tab === "Scheduled" ? <CalendarClock size={16} /> : <Target size={16} />}
              {tab}
            </button>
          ))}
        </div>
        <CardContent className="space-y-4 pt-5">
          {visibleCampaigns.length ? (
            visibleCampaigns.map((campaign) => (
              <div
                className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                key={campaign.id}
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-white">{campaign.name}</h2>
                      <Badge variant={campaign.status === "Sent" ? "green" : campaign.status === "Scheduled" ? "blue" : "slate"}>
                        {campaign.status}
                      </Badge>
                      <Badge variant="amber">{campaign.channel}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {campaign.date} · {campaign.contacts} contatos
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {[
                      ["Disparos", campaign.sent, Send],
                      ["Entregas", campaign.delivered, CheckCircle2],
                      ["Leituras", campaign.reads, Eye],
                      ["Cliques", campaign.clicks, MousePointerClick],
                      ["Conversões", campaign.conversions, TrendingUp],
                    ].map(([label, value, Icon]) => {
                      const MetricIcon = Icon as typeof Send;
                      return (
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3" key={label as string}>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <MetricIcon size={13} />
                            {label as string}
                          </div>
                          <p className="mt-1 font-semibold text-white">{value as number}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>Taxa de entrega</span>
                      <span>{campaign.deliveryRate}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800">
                      <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${campaign.deliveryRate}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>Taxa de conversão</span>
                      <span>{campaign.conversionRate}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800">
                      <div className="h-2 rounded-full bg-sky-400" style={{ width: `${campaign.conversionRate}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center text-center text-slate-500">
              <Send className="mb-3" size={34} />
              <p className="font-semibold text-slate-300">No campaigns {activeTab.toLowerCase()}</p>
              <p className="text-sm">Create your first communication campaign.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>Create a campaign with segmentation and scheduling.</DialogDescription>
          </DialogHeader>
          <form className="space-y-5 p-6" onSubmit={createCampaign}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Canal</Label>
                <select
                  className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none"
                  value={form.channel}
                  onChange={(event) => setForm({ ...form, channel: event.target.value })}
                >
                  <option>WhatsApp</option>
                  <option>Email</option>
                  <option>Telegram</option>
                  <option>Webhook</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Segmentação</Label>
                <select
                  className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none"
                  value={form.segment}
                  onChange={(event) => setForm({ ...form, segment: event.target.value })}
                >
                  <option>Clientes ativos</option>
                  <option>Leads novos</option>
                  <option>Clientes inadimplentes</option>
                  <option>Oportunidades abertas</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Data/Hora de envio</Label>
                <Input type="datetime-local" value={form.scheduleAt} onChange={(event) => setForm({ ...form, scheduleAt: event.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-800 pt-5">
              <DialogClose asChild>
                <Button type="button" variant="secondary">Cancelar</Button>
              </DialogClose>
              <Button type="submit">Salvar campanha</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
