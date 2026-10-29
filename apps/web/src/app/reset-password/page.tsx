"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset", { token, password }, null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) return <p role="alert" className="text-sm text-red-700">Link inválido. Solicite um novo.</p>;
  if (done) {
    return (
      <div className="space-y-3 text-sm" role="status">
        <p>Senha redefinida. Todas as sessões anteriores foram encerradas.</p>
        <Link href="/login" className="underline" style={{ color: "var(--vx-primary)" }}>Ir para o login</Link>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="password">Nova senha</Label>
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} />
        <p className="text-xs vx-muted">Mínimo de 10 caracteres, com letras e números.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirmar senha</Label>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
      </div>
      {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <Button className="w-full" disabled={loading} type="submit">Redefinir senha</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Nova senha">
      <Suspense fallback={null}><ResetForm /></Suspense>
    </AuthLayout>
  );
}
