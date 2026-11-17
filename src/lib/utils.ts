import type { ExpiryValue } from "./types";

const HISTORY_KEY = "yunclip.recent.v1";

export function formatDate(ms: number, withYear = false): string {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      ...(withYear ? { year: "numeric" as const } : {}),
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function formatFullDate(ms: number): string {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export function timeAgo(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(ms);
}

export function expiryText(expiresAt: number | null): string {
  if (!expiresAt) return "永久保存";
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return "已过期";
  if (remaining < 3_600_000) return `${Math.max(1, Math.ceil(remaining / 60_000))} 分钟后过期`;
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)} 小时后过期`;
  return `${Math.ceil(remaining / 86_400_000)} 天后过期`;
}

export function expiryLabel(value: ExpiryValue | "custom" | "expired"): string {
  const labels: Record<string, string> = {
    never: "永久保存",
    "1h": "1 小时",
    "6h": "6 小时",
    "1d": "1 天",
    "3d": "3 天",
    "7d": "7 天",
    "30d": "30 天",
    custom: "自定义时间",
    expired: "已过期",
  };
  return labels[value] ?? value;
}

export function chars(text: string): number {
  return Array.from(text).length;
}

export function lines(text: string): number {
  return text ? text.split("\n").length : 0;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function noteUrl(slug: string): string {
  return `${window.location.origin}/n/${encodeURIComponent(slug)}`;
}

export function shortUrl(slug: string): string {
  return `/n/${encodeURIComponent(slug)}`;
}

export function isValidSlug(value: string): boolean {
  const slug = value.trim();
  if (!slug || Array.from(slug).length > 32) return false;
  if (!/^[\p{L}\p{N}_-]+$/u.test(slug)) return false;
  return !slug.startsWith("_") && !slug.startsWith("-");
}

export function randomSlug(length = 10): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("copy failed");
}

export function downloadText(text: string, filename: string, type = "text/plain;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface RecentNote {
  slug: string;
  title: string;
  updatedAt: number;
}

export function getRecent(): RecentNote[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.slug === "string")
      .slice(0, 8)
      .map((item) => ({
        slug: String(item.slug),
        title: String(item.title || ""),
        updatedAt: Number(item.updatedAt) || 0,
      }));
  } catch {
    return [];
  }
}

export function addRecent(note: { slug: string; title: string; updatedAt: number }): RecentNote[] {
  const next = [
    { slug: note.slug, title: note.title || "", updatedAt: note.updatedAt || Date.now() },
    ...getRecent().filter((item) => item.slug !== note.slug),
  ].slice(0, 6);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 忽略隐私模式下的存储异常
  }
  return next;
}

export function removeRecent(slug: string): RecentNote[] {
  const next = getRecent().filter((item) => item.slug !== slug);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("yunclip.theme", theme);
  } catch {
    // ignore
  }
}

export function getPreferredTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem("yunclip.theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
