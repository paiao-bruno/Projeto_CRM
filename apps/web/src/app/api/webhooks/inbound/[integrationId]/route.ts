import { NextRequest, NextResponse } from "next/server";
import { getChannelsService } from "@/server/channels";
import { HttpError, jsonError } from "@/server/http";
import { MAX_BODY_BYTES, WebhookService } from "@/server/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lê o corpo BRUTO respeitando o limite, sem materializar payloads maiores que o permitido. */
async function readRaw(request: NextRequest): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, "Payload grande demais.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "Payload grande demais.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

let service: WebhookService | null = null;

export async function POST(request: NextRequest, context: { params: Promise<{ integrationId: string }> }) {
  try {
    const { integrationId } = await context.params;
    service ??= new WebhookService(getChannelsService());
    const result = await service.handle({ integrationId, headers: request.headers, rawBody: await readRaw(request) });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
