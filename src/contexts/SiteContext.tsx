import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { SitePayload, SiteSettings } from "../lib/types";

export const FALLBACK_SETTINGS: SiteSettings = {
  siteName: "云夹",
  tagline: "文字留在云端，灵感跟着你走。",
  description: "一个极简、免登录的在线云剪贴板。写下文字，换个设备打开同一个链接，继续编辑。",
  announcement: "",
  footerText: "",
  allowCreate: true,
  maxNoteLength: 200_000,
  defaultExpiry: "never",
  updatedAt: 0,
};

interface SiteContextValue {
  settings: SiteSettings;
  stats: { notes: number };
  storageConfigured: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

const SiteContext = createContext<SiteContextValue>({
  settings: FALLBACK_SETTINGS,
  stats: { notes: 0 },
  storageConfigured: true,
  loading: true,
  error: "",
  refresh: async () => {},
});

export function SiteProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<SitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api.getSite();
      setPayload(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "站点信息加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SiteContextValue>(
    () => ({
      settings: payload?.settings ?? FALLBACK_SETTINGS,
      stats: payload?.stats ?? { notes: 0 },
      storageConfigured: payload?.storageConfigured ?? true,
      loading,
      error,
      refresh,
    }),
    [payload, loading, error, refresh],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}
