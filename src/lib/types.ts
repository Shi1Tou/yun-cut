export type ExpiryValue = "never" | "1h" | "6h" | "1d" | "3d" | "7d" | "30d";

export interface SiteSettings {
  siteName: string;
  tagline: string;
  description: string;
  announcement: string;
  footerText: string;
  allowCreate: boolean;
  maxNoteLength: number;
  defaultExpiry: ExpiryValue;
  updatedAt: number;
}

export interface SitePayload {
  settings: SiteSettings;
  stats: { notes: number };
  storageConfigured: boolean;
}

export interface Note {
  slug: string;
  title: string;
  content: string;
  version: number;
  views: number;
  size: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  protected: boolean;
}

export type NoteMeta = Omit<Note, "content"> & { expired?: boolean };

export interface AdminStatsPayload {
  stats: {
    totalNotes: number;
    totalChars: number;
    totalViews: number;
    totalSaves: number;
    protectedNotes: number;
    expiringSoon: number;
    expiredNotes: number;
  };
  trend: Array<{ date: string; created: number; saves: number; views: number }>;
  recent: NoteMeta[];
  top: Array<Pick<NoteMeta, "slug" | "title" | "views" | "size" | "updatedAt">>;
  storageConfigured: boolean;
}

export interface AdminNotesPayload {
  items: NoteMeta[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  truncated: boolean;
}

export interface AuditEntry {
  at: number;
  action: string;
  target: string;
  ip: string;
  detail: string;
}

export interface AdminSession {
  authenticated: boolean;
  username: string;
  expiresAt: number;
}

export interface AdminLoginPayload {
  authenticated: boolean;
  username: string;
  expiresAt: number;
}
