import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string | string[],
  ) {
    super(Array.isArray(message) ? message.join(", ") : message);
  }
}

export function jsonData<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { message: error.message, statusCode: error.status },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json(
    { message: "Erro interno do servidor.", statusCode: 500 },
    { status: 500 },
  );
}

export function parseBooleanQuery(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseDealFilters(searchParams: URLSearchParams) {
  return {
    search: searchParams.get("search") ?? undefined,
    stageCode: searchParams.get("stageCode") ?? undefined,
    ownerMemberId: searchParams.get("ownerMemberId") ?? undefined,
    entrySource: searchParams.get("entrySource") ?? undefined,
    clientType: searchParams.get("clientType") ?? undefined,
    contactType: searchParams.get("contactType") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    neighborhood: searchParams.get("neighborhood") ?? undefined,
    priority: (searchParams.get("priority") as never) ?? undefined,
    includeArchived: parseBooleanQuery(searchParams.get("includeArchived")),
    includeLost: parseBooleanQuery(searchParams.get("includeLost")),
    createdFrom: searchParams.get("createdFrom") ?? undefined,
    createdTo: searchParams.get("createdTo") ?? undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  };
}
