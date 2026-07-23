"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function UnavailableFeature({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[420px] max-w-2xl items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-slate-300">
          <p>
            {description ??
              "Esta funcionalidade ainda não está disponível neste ambiente."}
          </p>
          <Button asChild variant="secondary">
            <Link href="/dashboard">
              <ArrowLeft size={16} />
              Voltar ao dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
