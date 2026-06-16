"use client";

import { FormEvent, useState } from "react";
import { Bot, Loader2, RadioTower } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@ispcrm.local");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao autenticar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between p-10 lg:flex">
        <div className="flex items-center gap-3 text-lg font-bold">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
            <RadioTower size={22} />
          </span>
          ISP CRM SaaS
        </div>

        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
            <Bot size={16} />
            Atendimento, IA e CRM para provedores
          </div>
          <h1 className="text-5xl font-semibold leading-tight text-white">
            Centralize conversas, clientes e agentes inteligentes em uma operacao moderna.
          </h1>
          <p className="mt-5 text-lg text-slate-300">
            Dashboard em tempo real, chat operacional, agentes IA e CRM comercial em uma base multitenant.
          </p>
        </div>

        <p className="text-sm text-slate-500">Login demo: admin@ispcrm.local / admin123</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">Entrar no CRM</CardTitle>
            <p className="text-sm text-slate-400">
              Use as credenciais demo para acessar a aplicacao local.
            </p>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error ? (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              <Button className="w-full" disabled={loading} type="submit">
                {loading ? <Loader2 className="animate-spin" size={18} /> : null}
                Acessar aplicacao
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
