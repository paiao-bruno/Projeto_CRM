"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot", { email }, null);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o pedido.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Recuperar acesso" subtitle="Informe seu e-mail. Se ele estiver cadastrado, enviaremos as instruções.">
      {sent ? (
        <div className="space-y-3 text-sm" role="status">
          <p>Pedido registrado. Se o e-mail estiver cadastrado, as instruções serão enviadas.</p>
          <p className="vx-muted">Se o e-mail não chegar, peça ao administrador da sua organização um link de redefinição.</p>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
          <Button className="w-full" disabled={loading} type="submit">Enviar instruções</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/login" className="underline" style={{ color: "var(--vx-primary)" }}>Voltar ao login</Link></p>
    </AuthLayout>
  );
}
