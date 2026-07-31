import { LoginResponse } from "./types";
import { resolveApiBaseUrl } from "./runtime-config";

const API_URL = resolveApiBaseUrl();

type RequestOptions = RequestInit & {
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "Erro ao conectar com a API.";
    try {
      const payload = await response.json();
      message = payload.message ?? message;
    } catch {
      message = response.statusText;
    }
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },
  get<T>(path: string, token?: string | null) {
    return request<T>(path, { token });
  },
  post<T>(path: string, body: unknown, token?: string | null) {
    return request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    });
  },
  patch<T>(path: string, body: unknown, token?: string | null) {
    return request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    });
  },
  delete<T>(path: string, token?: string | null) {
    return request<T>(path, {
      method: "DELETE",
      token,
    });
  },
};
