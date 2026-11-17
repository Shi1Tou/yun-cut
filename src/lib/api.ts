import type {
  AdminLoginPayload,
  AdminNotesPayload,
  AdminSession,
  AdminStatsPayload,
  AuditEntry,
  Note,
  SitePayload,
  SiteSettings,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  data: unknown;

  constructor(status: number, code: string, message: string, data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "网络连接失败，请检查网络后重试");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "请求失败，请稍后再试",
      error ?? data,
    );
  }
  return data as T;
}

function noteHeaders(password?: string): Record<string, string> {
  return password ? { "x-note-password": password } : {};
}

export const api = {
  getSite: () => request<SitePayload>("/api/site"),
  getHealth: () => request<{ ok: boolean; storageConfigured: boolean; storageOk: boolean }>("/api/health"),

  getNote: (slug: string, password?: string, visit = false) =>
    request<{ note: Note }>(`/api/notes/${encodeURIComponent(slug)}${visit ? "?visit=1" : ""}`, {
      headers: noteHeaders(password),
    }),

  createNote: (body: {
    slug?: string;
    title?: string;
    content?: string;
    password?: string;
    expiresIn?: string;
  }) => request<{ note: Note; passwordProtected: boolean }>("/api/notes", { method: "POST", body }),

  updateNote: (
    slug: string,
    body: {
      title?: string;
      content?: string;
      version?: number;
      password?: string;
      setPassword?: string | null;
      expiresIn?: string;
    },
    password?: string,
  ) =>
    request<{ note: Note }>(`/api/notes/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: noteHeaders(password),
      body,
    }),

  deleteNote: (slug: string, confirm: string, password?: string) =>
    request<{ ok: boolean }>(`/api/notes/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: noteHeaders(password),
      body: { confirm },
    }),

  adminLogin: (username: string, password: string) =>
    request<AdminLoginPayload>("/api/admin/login", { method: "POST", body: { username, password } }),

  adminLogout: () => request<{ ok: boolean }>("/api/admin/logout", { method: "POST" }),

  adminSession: () => request<AdminSession>("/api/admin/session"),

  adminStats: () => request<AdminStatsPayload>("/api/admin/stats"),

  adminNotes: (params: { q?: string; page?: number; limit?: number; sort?: string; filter?: string }) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.page) search.set("page", String(params.page));
    if (params.limit) search.set("limit", String(params.limit));
    if (params.sort) search.set("sort", params.sort);
    if (params.filter) search.set("filter", params.filter);
    return request<AdminNotesPayload>(`/api/admin/notes?${search.toString()}`);
  },

  adminNote: (slug: string) =>
    request<{ note: Note }>(`/api/admin/notes/${encodeURIComponent(slug)}`),

  adminDeleteNote: (slug: string) =>
    request<{ ok: boolean }>(`/api/admin/notes/${encodeURIComponent(slug)}`, { method: "DELETE" }),

  adminSettings: () => request<{ settings: SiteSettings }>("/api/admin/settings"),

  adminSaveSettings: (settings: Partial<SiteSettings>) =>
    request<{ settings: SiteSettings }>("/api/admin/settings", { method: "PUT", body: settings }),

  adminAudit: (limit = 80) => request<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`),

  adminCleanup: () => request<{ ok: boolean; removed: number }>("/api/admin/cleanup", { method: "POST" }),

  adminExport: async () => {
    let response: Response;
    try {
      response = await fetch("/api/admin/export", { credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "NETWORK", "网络连接失败");
    }
    if (!response.ok) throw new ApiError(response.status, "EXPORT_FAILED", "导出失败，请重新登录后再试");
    return response.blob();
  },
};
