"use client";

import { CalendarDays, Clock, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const events = [
  {
    id: "install",
    title: "Instalação Fibra - Mariana Costa",
    time: "Hoje, 14:30",
    type: "Instalação",
  },
  {
    id: "follow-up",
    title: "Follow-up lead Condomínio Jardim Norte",
    time: "Amanhã, 09:00",
    type: "Comercial",
  },
];

export default function SchedulePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Schedule</h1>
            <Badge variant="blue">Acquire</Badge>
          </div>
          <p className="mt-1 text-slate-400">Calendário, tarefas e agendamentos automáticos.</p>
        </div>
        <Button>
          <Plus size={17} />
          New Schedule
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-slate-400">Eventos</p>
              <p className="mt-2 text-3xl font-semibold text-white">{events.length}</p>
            </div>
            <CalendarDays className="text-emerald-300" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-slate-400">Automáticos</p>
              <p className="mt-2 text-3xl font-semibold text-white">1</p>
            </div>
            <Sparkles className="text-emerald-300" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-slate-400">Próximo</p>
              <p className="mt-2 text-3xl font-semibold text-white">14:30</p>
            </div>
            <Clock className="text-emerald-300" />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Agenda</CardTitle>
          <p className="text-sm text-slate-400">Eventos mockados para demonstração.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {events.map((event) => (
            <div
              className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 md:flex-row md:items-center"
              key={event.id}
            >
              <div>
                <p className="font-semibold text-white">{event.title}</p>
                <p className="text-sm text-slate-500">{event.time}</p>
              </div>
              <Badge variant="green">{event.type}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
