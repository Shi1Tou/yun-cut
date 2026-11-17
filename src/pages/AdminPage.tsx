import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  Download,
  Eye,
  FileSearch,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  TrendingUp,
  X,
} from "lucide-react";

import { api, ApiError } from "../lib/api";
import type { AdminNotesPayload, AdminStatsPayload, AuditEntry, Note, NoteMeta, SiteSettings } from "../lib/types";
import { copyText, downloadText, expiryLabel, formatBytes, formatFullDate, formatNumber, timeAgo } from "../lib/utils";
import { useSite } from "../contexts/SiteContext";
import { useToast } from "../contexts/ToastContext";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { Modal } from "../components/Modal";

type Tab = "overview" | "notes" | "settings" | "audit";

const TAB_META: Record<Tab, { label: string; title: string; subtitle: string }> = {
  overview: { label: "概览", title: "概览", subtitle: "站点状态、内容趋势和最近活动" },
  notes: { label: "剪贴板", title: "剪贴板管理", subtitle: "查看、搜索和清理所有公开或加密内容" },
  settings: { label: "站点设置", title: "站点设置", subtitle: "调整站点文案、新建规则和默认行为" },
  audit: { label: "操作日志", title: "操作日志", subtitle: "管理员登录、删除和设置变更记录" },
};

const ACTION_LABELS: Record<string, string> = {
  "admin.login": "管理员登录",
  "admin.login_failed": "登录失败",
  "admin.logout": "退出登录",
  "admin.note_delete": "删除剪贴板",
  "admin.settings_update": "更新站点设置",
  "admin.cleanup": "清理过期内容",
  "note.create": "创建剪贴板",
  "note.delete": "删除剪贴板",
};

function tabFromHash(): Tab {
  const value = window.location.hash.replace(/^#/, "");
  return value === "notes" || value === "settings" || value === "audit" ? value : "overview";
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 19) return "下午好";
  return "晚上好";
}

function StatCard({ icon: Icon, label, value, hint, tone = "blue" }: {
  icon: typeof FileText;
  label: string;
  value: string;
  hint: string;
  tone?: "blue" | "violet" | "emerald" | "amber";
}) {
  return (
    <div className={`admin-stat tone-${tone}`}>
      <span className="admin-stat-icon"><Icon size={19} /></span>
      <span className="admin-stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="admin-stat-hint">{hint}</span>
    </div>
  );
}

function StatusBadge({ note }: { note: Pick<NoteMeta, "protected" | "expired"> }) {
  if (note.expired) return <span className="status-pill is-muted">已过期</span>;
  if (note.protected) return <span className="status-pill is-violet"><LockKeyhole size={11} /> 加密</span>;
  return <span className="status-pill is-green">公开</span>;
}

function AdminSidebar({
  tab,
  setTab,
  username,
  onLogout,
  open,
  setOpen,
  siteName,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  username: string;
  onLogout: () => void;
  open: boolean;
  setOpen: (value: boolean) => void;
  siteName: string;
}) {
  const items: Array<{ key: Tab; label: string; icon: typeof LayoutDashboard }> = [
    { key: "overview", label: "概览", icon: LayoutDashboard },
    { key: "notes", label: "剪贴板", icon: ClipboardList },
    { key: "settings", label: "站点设置", icon: Settings2 },
    { key: "audit", label: "操作日志", icon: Activity },
  ];
  return (
    <>
      {open && <button type="button" className="admin-sidebar-scrim" onClick={() => setOpen(false)} aria-label="关闭菜单" />}
      <aside className={`admin-sidebar ${open ? "is-open" : ""}`}>
        <div className="admin-sidebar-top">
          <Logo siteName={siteName} />
          <button type="button" className="icon-btn admin-sidebar-close" onClick={() => setOpen(false)} aria-label="关闭菜单"><X size={18} /></button>
        </div>
        <p className="admin-nav-label">工作台</p>
        <nav className="admin-nav">
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              className={tab === item.key ? "is-active" : ""}
              onClick={() => { setTab(item.key); setOpen(false); }}
            >
              <item.icon size={17} />
              {item.label}
              {tab === item.key && <span className="admin-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-tip">
          <ShieldCheck size={16} />
          <p>管理员凭据来自环境变量，不会写入数据库。</p>
        </div>
        <div className="admin-sidebar-user">
          <span className="admin-avatar">{username.slice(0, 1).toUpperCase()}</span>
          <div><strong>{username}</strong><span>超级管理员</span></div>
          <button type="button" className="icon-btn" onClick={onLogout} title="退出登录" aria-label="退出登录"><LogOut size={16} /></button>
        </div>
      </aside>
    </>
  );
}

function TrendChart({ trend }: { trend: AdminStatsPayload["trend"] }) {
  const max = Math.max(1, ...trend.map((day) => Math.max(day.created, day.saves)));
  return (
    <div className="trend-chart">
      <div className="chart-legend">
        <span><i className="legend-created" /> 新建</span>
        <span><i className="legend-saves" /> 保存</span>
      </div>
      <div className="chart-bars">
        {trend.map((day) => (
          <div className="chart-col" key={day.date}>
            <div className="chart-bar-group">
              <span
                className="chart-bar is-created"
                style={{ height: `${Math.max(4, Math.round((day.created / max) * 100))}%` }}
                title={`${day.date} 新建 ${day.created} 个`}
              />
              <span
                className="chart-bar is-saves"
                style={{ height: `${Math.max(4, Math.round((day.saves / max) * 100))}%` }}
                title={`${day.date} 保存 ${day.saves} 次`}
              />
            </div>
            <span className="chart-date">{day.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminPage() {
  const navigate = useNavigate();
  const { settings, refresh: refreshSite } = useSite();
  const { success, error: toastError } = useToast();
  const [auth, setAuth] = useState<"checking" | "ok">("checking");
  const [username, setUsername] = useState("");
  const [tab, setTabState] = useState<Tab>(() => tabFromHash());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, "", `#${next}`);
  }, []);

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [stats, setStats] = useState<AdminStatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [notes, setNotes] = useState<AdminNotesPayload | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated");
  const [filter, setFilter] = useState("all");

  const [settingsForm, setSettingsForm] = useState<SiteSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [viewing, setViewing] = useState<Note | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NoteMeta | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleAuthError = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && err.status === 401) {
      navigate("/admin/login", { replace: true });
      return true;
    }
    return false;
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    api.adminSession()
      .then((session) => {
        if (cancelled) return;
        setUsername(session.username);
        setAuth("ok");
      })
      .catch(() => {
        if (!cancelled) navigate("/admin/login", { replace: true });
      });
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    document.title = `${TAB_META[tab].label} · 管理后台 · ${settings.siteName}`;
  }, [tab, settings.siteName]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await api.adminStats());
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "概览加载失败");
    } finally {
      setStatsLoading(false);
    }
  }, [handleAuthError, toastError]);

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      setNotes(await api.adminNotes({ q: query, page, sort, filter, limit: 20 }));
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "列表加载失败");
    } finally {
      setNotesLoading(false);
    }
  }, [filter, handleAuthError, page, query, sort, toastError]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const result = await api.adminSettings();
      setSettingsForm(result.settings);
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "设置加载失败");
    } finally {
      setSettingsLoading(false);
    }
  }, [handleAuthError, toastError]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const result = await api.adminAudit(100);
      setAudit(result.entries);
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "日志加载失败");
    } finally {
      setAuditLoading(false);
    }
  }, [handleAuthError, toastError]);

  useEffect(() => {
    if (auth !== "ok") return;
    if (tab === "overview") void loadStats();
    if (tab === "notes") void loadNotes();
    if (tab === "settings") void loadSettings();
    if (tab === "audit") void loadAudit();
  }, [auth, tab, loadStats, loadNotes, loadSettings, loadAudit]);

  async function logout() {
    try { await api.adminLogout(); } catch { /* ignore */ }
    navigate("/admin/login", { replace: true });
  }

  function refreshCurrent() {
    if (tab === "overview") void loadStats();
    else if (tab === "notes") void loadNotes();
    else if (tab === "settings") void loadSettings();
    else void loadAudit();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(searchInput.trim());
  }

  async function openNote(slug: string) {
    setViewLoading(true);
    setViewing(null);
    try {
      const result = await api.adminNote(slug);
      setViewing(result.note);
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "内容读取失败");
    } finally {
      setViewLoading(false);
    }
  }

  async function removeNote() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.adminDeleteNote(deleteTarget.slug);
      success("剪贴板已删除");
      setDeleteTarget(null);
      setViewing(null);
      await loadNotes();
      await loadStats();
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function cleanup() {
    setCleanupLoading(true);
    try {
      const result = await api.adminCleanup();
      success(result.removed > 0 ? `已清理 ${result.removed} 个过期剪贴板` : "没有需要清理的过期内容");
      setCleanupOpen(false);
      await loadNotes();
      await loadStats();
      await loadAudit();
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "清理失败");
    } finally {
      setCleanupLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.adminExport();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `yunclip-notes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      success("CSV 已开始下载");
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settingsForm || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const result = await api.adminSaveSettings(settingsForm);
      setSettingsForm(result.settings);
      await refreshSite();
      success("站点设置已保存");
    } catch (err) {
      if (!handleAuthError(err)) toastError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  function updateSetting<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettingsForm((current) => (current ? { ...current, [key]: value } : current));
  }

  const activeMeta = TAB_META[tab];
  const recent = useMemo(() => stats?.recent ?? [], [stats]);

  if (auth === "checking") {
    return <div className="admin-login-boot"><Loader2 className="spin" size={22} /><span>正在验证管理会话…</span></div>;
  }

  return (
    <div className="admin-shell">
      <AdminSidebar
        tab={tab}
        setTab={setTab}
        username={username}
        onLogout={() => void logout()}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        siteName={settings.siteName}
      />
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button type="button" className="icon-btn admin-menu-btn" onClick={() => setSidebarOpen(true)} aria-label="打开菜单"><Menu size={19} /></button>
            <div>
              <h1>{activeMeta.title}</h1>
              <p>{activeMeta.subtitle}</p>
            </div>
          </div>
          <div className="admin-topbar-actions">
            <Link to="/" className="btn btn-ghost btn-sm"><Eye size={14} /> 查看站点</Link>
            <button type="button" className="icon-btn" onClick={refreshCurrent} title="刷新" aria-label="刷新"><RefreshCw size={17} /></button>
            <ThemeToggle />
          </div>
        </header>

        <main className="admin-content">
          {tab === "overview" && (
            <div className="admin-tab">
              <div className="admin-welcome">
                <div>
                  <p className="eyebrow"><Sparkles size={13} /> OVERVIEW</p>
                  <h2>{greeting()}，{username}</h2>
                  <p>这里是你部署实例的全部内容。保持轻量，也保持可控。</p>
                </div>
                <div className="admin-welcome-actions">
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => setCleanupOpen(true)}><Trash2 size={14} /> 清理过期</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void exportCsv()} disabled={exporting}>
                    {exporting ? <Loader2 size={14} className="spin" /> : <ArrowDownToLine size={14} />} 导出 CSV
                  </button>
                </div>
              </div>

              {statsLoading && !stats ? <div className="panel-loading"><Loader2 className="spin" size={20} /> 正在读取数据…</div> : stats && (
                <>
                  <div className="admin-stat-grid">
                    <StatCard icon={FileText} label="剪贴板总数" value={formatNumber(stats.stats.totalNotes)} hint={`${formatNumber(stats.stats.expiredNotes)} 个已过期`} />
                    <StatCard icon={Gauge} label="累计字符" value={formatNumber(stats.stats.totalChars)} hint={`${formatNumber(stats.stats.totalSaves)} 次保存`} tone="violet" />
                    <StatCard icon={TrendingUp} label="累计浏览" value={formatNumber(stats.stats.totalViews)} hint="来自页面打开次数" tone="emerald" />
                    <StatCard icon={LockKeyhole} label="加密内容" value={formatNumber(stats.stats.protectedNotes)} hint={`${formatNumber(stats.stats.expiringSoon)} 个即将过期`} tone="amber" />
                  </div>

                  <div className="admin-two-col">
                    <section className="admin-panel">
                      <div className="admin-panel-head">
                        <div><h3><BarChart3 size={16} /> 最近 7 天</h3><p>新建与保存次数变化</p></div>
                        <span className="panel-tag">UTC</span>
                      </div>
                      <TrendChart trend={stats.trend} />
                    </section>

                    <section className="admin-panel">
                      <div className="admin-panel-head">
                        <div><h3><Database size={16} /> 存储状态</h3><p>EdgeOne KV · 最终一致性</p></div>
                        <span className={`status-pill ${stats.storageConfigured ? "is-green" : "is-red"}`}>{stats.storageConfigured ? "已连接" : "未配置"}</span>
                      </div>
                      <div className="storage-info">
                        <div><span>绑定变量</span><code>CLIPBOARD_KV</code></div>
                        <div><span>同步策略</span><span>跨节点最长 60 秒</span></div>
                        <div><span>单次请求体</span><span>≤ 1 MB</span></div>
                        <div><span>内容上限</span><span>{formatNumber(settings.maxNoteLength)} 字符</span></div>
                      </div>
                      <div className="storage-tip"><ShieldCheck size={15} /> 数据只保存在你的 EdgeOne 账户中。</div>
                    </section>
                  </div>

                  <section className="admin-panel">
                    <div className="admin-panel-head">
                      <div><h3><Clock3 size={16} /> 最近更新</h3><p>最近被创建或编辑的剪贴板</p></div>
                      <button type="button" className="text-btn" onClick={() => setTab("notes")}>查看全部 <ArrowUpRight size={13} /></button>
                    </div>
                    {recent.length === 0 ? (
                      <div className="admin-empty"><FileSearch size={20} /><span>还没有任何剪贴板</span></div>
                    ) : (
                      <div className="admin-table-wrap">
                        <table className="admin-table recent-table">
                          <thead><tr><th>名称</th><th>标题</th><th>大小</th><th>状态</th><th>更新时间</th><th /></tr></thead>
                          <tbody>
                            {recent.map((item) => (
                              <tr key={item.slug}>
                                <td><code className="table-slug">{item.slug}</code></td>
                                <td>{item.title || <span className="muted">无标题</span>}</td>
                                <td>{formatBytes(item.size)}</td>
                                <td><StatusBadge note={item} /></td>
                                <td>{timeAgo(item.updatedAt)}</td>
                                <td className="table-actions"><button type="button" className="icon-btn" onClick={() => void openNote(item.slug)} aria-label={`查看 ${item.slug}`}><Eye size={15} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {stats.top.length > 0 && (
                    <section className="admin-panel">
                      <div className="admin-panel-head"><div><h3><TrendingUp size={16} /> 浏览最多</h3><p>按打开次数排序</p></div></div>
                      <div className="top-list">
                        {stats.top.map((item, index) => (
                          <button type="button" className="top-item" key={item.slug} onClick={() => void openNote(item.slug)}>
                            <span className="top-rank">{String(index + 1).padStart(2, "0")}</span>
                            <span className="top-main"><strong>{item.title || item.slug}</strong><code>{item.slug}</code></span>
                            <span className="top-views"><Eye size={13} /> {formatNumber(item.views)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "notes" && (
            <div className="admin-tab">
              <div className="admin-toolbar">
                <form className="admin-search" onSubmit={submitSearch}>
                  <Search size={16} />
                  <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索名称或标题…" aria-label="搜索剪贴板" />
                  {searchInput && <button type="button" onClick={() => { setSearchInput(""); setQuery(""); setPage(1); }} aria-label="清除搜索"><X size={14} /></button>}
                  <button type="submit" className="btn btn-soft btn-sm">搜索</button>
                </form>
                <div className="admin-filters">
                  <label><SlidersHorizontal size={14} /><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="all">全部状态</option><option value="public">公开</option><option value="protected">加密</option><option value="expired">已过期</option></select></label>
                  <label><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="updated">最近更新</option><option value="created">最近创建</option><option value="size">体积最大</option><option value="views">浏览最多</option><option value="name">名称排序</option></select></label>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => setCleanupOpen(true)}><Trash2 size={14} /> 清理</button>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => void exportCsv()} disabled={exporting}><Download size={14} /> 导出</button>
                </div>
              </div>

              <section className="admin-panel admin-panel-flush">
                <div className="admin-panel-head">
                  <div><h3><ClipboardList size={16} /> 全部剪贴板</h3><p>{notes ? `共 ${formatNumber(notes.total)} 条${notes.truncated ? "（仅显示前 3000 条）" : ""}` : "正在读取…"}</p></div>
                  <button type="button" className="icon-btn" onClick={() => void loadNotes()} title="刷新列表" aria-label="刷新列表"><RefreshCw size={16} className={notesLoading ? "spin" : ""} /></button>
                </div>

                {notesLoading && !notes ? <div className="panel-loading"><Loader2 className="spin" size={20} /> 正在读取…</div> : notes && notes.items.length === 0 ? (
                  <div className="admin-empty"><FileSearch size={22} /><span>没有匹配的剪贴板</span><p>换一个关键词或状态试试。</p></div>
                ) : notes && (
                  <>
                    <div className="admin-table-wrap">
                      <table className="admin-table notes-table">
                        <thead><tr><th>名称</th><th>标题</th><th>大小</th><th>浏览</th><th>状态</th><th>更新</th><th /></tr></thead>
                        <tbody>
                          {notes.items.map((item) => (
                            <tr key={item.slug}>
                              <td><code className="table-slug">{item.slug}</code></td>
                              <td>{item.title || <span className="muted">无标题</span>}</td>
                              <td>{formatBytes(item.size)}</td>
                              <td>{formatNumber(item.views)}</td>
                              <td><StatusBadge note={item} /></td>
                              <td title={formatFullDate(item.updatedAt)}>{timeAgo(item.updatedAt)}</td>
                              <td className="table-actions">
                                <button type="button" className="icon-btn" onClick={() => void openNote(item.slug)} title="查看" aria-label={`查看 ${item.slug}`}><Eye size={15} /></button>
                                <button type="button" className="icon-btn is-danger" onClick={() => setDeleteTarget(item)} title="删除" aria-label={`删除 ${item.slug}`}><Trash2 size={15} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="table-pagination">
                      <span>第 {notes.page} / {notes.pages} 页</span>
                      <div>
                        <button type="button" className="icon-btn" disabled={notes.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="上一页"><ChevronLeft size={17} /></button>
                        <button type="button" className="icon-btn" disabled={notes.page >= notes.pages} onClick={() => setPage((value) => value + 1)} aria-label="下一页"><ChevronRight size={17} /></button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {tab === "settings" && (
            <div className="admin-tab">
              {settingsLoading && !settingsForm ? <div className="panel-loading"><Loader2 className="spin" size={20} /> 正在读取设置…</div> : settingsForm && (
                <form className="settings-layout" onSubmit={saveSettings}>
                  <div className="settings-main">
                    <section className="admin-panel">
                      <div className="admin-panel-head"><div><h3><FileText size={16} /> 站点信息</h3><p>这些文案会展示在首页、页头和分享卡片中</p></div></div>
                      <div className="form-grid">
                        <label className="field"><span>站点名称</span><input value={settingsForm.siteName} onChange={(event) => updateSetting("siteName", event.target.value)} maxLength={40} required /><em>显示在页头与浏览器标题</em></label>
                        <label className="field"><span>一句话标语</span><input value={settingsForm.tagline} onChange={(event) => updateSetting("tagline", event.target.value)} maxLength={120} /><em>首页主视觉下方的一句话</em></label>
                        <label className="field field-span"><span>站点描述</span><textarea value={settingsForm.description} onChange={(event) => updateSetting("description", event.target.value)} maxLength={240} rows={2} /><em>用于首页说明与 SEO 描述</em></label>
                        <label className="field field-span"><span>顶部公告</span><textarea value={settingsForm.announcement} onChange={(event) => updateSetting("announcement", event.target.value)} maxLength={240} rows={2} placeholder="留空则不显示公告" /><em>适合放维护通知或使用说明</em></label>
                        <label className="field"><span>页脚右侧文案</span><input value={settingsForm.footerText} onChange={(event) => updateSetting("footerText", event.target.value)} maxLength={120} placeholder="Keep it simple. Keep it close." /></label>
                      </div>
                    </section>

                    <section className="admin-panel">
                      <div className="admin-panel-head"><div><h3><SlidersHorizontal size={16} /> 新建规则</h3><p>控制公开入口的创建行为</p></div></div>
                      <div className="form-grid">
                        <label className="toggle-line field-span">
                          <span><strong>允许公开新建剪贴板</strong><em>关闭后，首页的创建按钮会被禁用，已有剪贴板仍可编辑</em></span>
                          <input type="checkbox" checked={settingsForm.allowCreate} onChange={(event) => updateSetting("allowCreate", event.target.checked)} />
                        </label>
                        <label className="field"><span>单条内容上限（字符）</span><input type="number" min={1000} max={300000} step={1000} value={settingsForm.maxNoteLength} onChange={(event) => updateSetting("maxNoteLength", Number(event.target.value))} /><em>受 EdgeOne 1 MB 请求体限制，建议不超过 300000</em></label>
                        <label className="field"><span>默认有效期</span><select value={settingsForm.defaultExpiry} onChange={(event) => updateSetting("defaultExpiry", event.target.value as SiteSettings["defaultExpiry"])}><option value="never">永久保存</option><option value="1h">1 小时</option><option value="6h">6 小时</option><option value="1d">1 天</option><option value="3d">3 天</option><option value="7d">7 天</option><option value="30d">30 天</option></select><em>用户未选择有效期时使用</em></label>
                      </div>
                    </section>
                  </div>

                  <aside className="settings-side">
                    <div className="admin-panel settings-save-card">
                      <h3>保存更改</h3>
                      <p>设置会写入 KV，并对所有边缘节点生效（最长约 60 秒）。</p>
                      <button type="submit" className="btn btn-primary btn-block" disabled={settingsSaving}>
                        {settingsSaving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {settingsSaving ? "保存中…" : "保存设置"}
                      </button>
                      <span className="settings-updated">最近更新：{settingsForm.updatedAt ? formatFullDate(settingsForm.updatedAt) : "尚未保存"}</span>
                    </div>
                    <div className="admin-panel security-card">
                      <ShieldCheck size={18} />
                      <h3>安全提醒</h3>
                      <p>管理员账号来自部署平台的环境变量。修改 <code>ADMIN_PASSWORD</code> 后，已有会话会在下次请求时失效。</p>
                    </div>
                  </aside>
                </form>
              )}
            </div>
          )}

          {tab === "audit" && (
            <div className="admin-tab">
              <section className="admin-panel">
                <div className="admin-panel-head">
                  <div><h3><Activity size={16} /> 操作日志</h3><p>最近 100 条管理员与内容操作</p></div>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => void loadAudit()}><RefreshCw size={14} className={auditLoading ? "spin" : ""} /> 刷新</button>
                </div>
                {auditLoading && audit.length === 0 ? <div className="panel-loading"><Loader2 className="spin" size={20} /> 正在读取日志…</div> : audit.length === 0 ? (
                  <div className="admin-empty"><Activity size={22} /><span>暂无操作记录</span></div>
                ) : (
                  <div className="audit-list">
                    {audit.map((entry, index) => (
                      <div className="audit-item" key={`${entry.at}-${index}`}>
                        <span className={`audit-dot ${entry.action.includes("failed") ? "is-warn" : ""}`} />
                        <div className="audit-main">
                          <strong>{ACTION_LABELS[entry.action] || entry.action}</strong>
                          {entry.target && <code>{entry.target}</code>}
                          {entry.detail && <span>{entry.detail}</span>}
                        </div>
                        <div className="audit-meta"><span>{formatFullDate(entry.at)}</span><span>{entry.ip}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      <Modal open={Boolean(viewing) || viewLoading} onClose={() => { setViewing(null); setViewLoading(false); }} title={viewing?.title || viewing?.slug || "读取中…"} subtitle={viewing ? `/n/${viewing.slug} · 更新于 ${formatFullDate(viewing.updatedAt)}` : "正在读取内容"} size="lg">
        {viewLoading ? <div className="panel-loading"><Loader2 className="spin" size={20} /> 正在读取…</div> : viewing && (
          <div className="admin-view">
            <div className="admin-view-meta">
              <span><FileText size={13} /> {formatBytes(viewing.size)}</span>
              <span><Eye size={13} /> {formatNumber(viewing.views)} 次浏览</span>
              <span><KeyRound size={13} /> {viewing.protected ? "密码保护" : "公开"}</span>
              <span><Clock3 size={13} /> {expiryLabel(viewing.expiresAt ? "custom" : "never")}</span>
            </div>
            <textarea className="admin-view-text" readOnly value={viewing.content} spellCheck={false} />
          </div>
        )}
        {viewing && (
          <footer className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { void copyText(viewing.content).then(() => success("内容已复制")).catch(() => toastError("复制失败")); }}><Copy size={15} /> 复制内容</button>
            <button type="button" className="btn btn-ghost" onClick={() => downloadText(viewing.content, `${viewing.slug}.txt`)}><Download size={15} /> 下载</button>
            <button type="button" className="btn btn-danger" onClick={() => { setDeleteTarget(viewing); setViewing(null); }}><Trash2 size={15} /> 删除</button>
          </footer>
        )}
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="确认删除" subtitle="这项操作不可撤销" size="sm">
        {deleteTarget && (
          <div className="delete-modal">
            <span className="delete-modal-icon"><TriangleAlert size={22} /></span>
            <p>将永久删除 <code>{deleteTarget.slug}</code>{deleteTarget.title ? `（${deleteTarget.title}）` : ""} 及其全部内容。</p>
            <div className="delete-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="btn btn-danger" onClick={() => void removeNote()} disabled={deleteLoading}>
                {deleteLoading ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} 永久删除
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={cleanupOpen} onClose={() => setCleanupOpen(false)} title="清理过期内容" subtitle="扫描所有剪贴板并删除已过期的条目" size="sm">
        <div className="delete-modal">
          <span className="delete-modal-icon is-neutral"><CalendarDays size={22} /></span>
          <p>只会删除已经超过有效期的剪贴板，不会影响仍在使用的链接。</p>
          <div className="delete-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setCleanupOpen(false)}>取消</button>
            <button type="button" className="btn btn-primary" onClick={() => void cleanup()} disabled={cleanupLoading}>
              {cleanupLoading ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} 开始清理
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
