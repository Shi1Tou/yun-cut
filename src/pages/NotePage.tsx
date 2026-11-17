import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  Download,
  Eye,
  FileQuestion,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  QrCode,
  RotateCcw,
  Save,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Type,
  Unlock,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { api, ApiError } from "../lib/api";
import type { Note } from "../lib/types";
import {
  addRecent,
  chars,
  copyText,
  downloadText,
  expiryText,
  formatBytes,
  formatDate,
  formatFullDate,
  lines,
  noteUrl,
  removeRecent,
  shortUrl,
  timeAgo,
} from "../lib/utils";
import { useSite } from "../contexts/SiteContext";
import { useToast } from "../contexts/ToastContext";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { LoadingScreen } from "../components/LoadingScreen";
import { PasswordGate } from "../components/PasswordGate";
import { Modal } from "../components/Modal";

type LoadState = "loading" | "ready" | "missing" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

const passwordKey = (slug: string) => `yunclip.pw.${slug}`;

function readStoredPassword(slug: string): string {
  try {
    return sessionStorage.getItem(passwordKey(slug)) || "";
  } catch {
    return "";
  }
}

function storePassword(slug: string, password: string): void {
  try {
    if (password) sessionStorage.setItem(passwordKey(slug), password);
    else sessionStorage.removeItem(passwordKey(slug));
  } catch {
    // ignore
  }
}

export function NotePage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { settings } = useSite();
  const { success, error: toastError } = useToast();

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [password, setPassword] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [gateError, setGateError] = useState("");
  const [gateLoading, setGateLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ version: number; updatedAt: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [expiryChoice, setExpiryChoice] = useState("keep");
  const [newPassword, setNewPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);

  const baseline = useRef({ title: "", content: "" });
  const versionRef = useRef(0);
  const titleRef = useRef("");
  const contentRef = useRef("");
  const passwordRef = useRef("");
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);

  const applyNote = useCallback((next: Note) => {
    setNote(next);
    setTitle(next.title);
    setContent(next.content);
    baseline.current = { title: next.title, content: next.content };
    versionRef.current = next.version;
    titleRef.current = next.title;
    contentRef.current = next.content;
    setLastSavedAt(next.updatedAt);
    setSaveState("saved");
    setSaveError("");
    setConflict(null);
    setNeedsPassword(false);
    setGateError("");
    setLoadState("ready");
    dirtyRef.current = false;
    addRecent(next);
  }, []);

  const loadNote = useCallback(async (pw: string) => {
    setLoadState("loading");
    setNeedsPassword(false);
    setGateError("");
    try {
      const result = await api.getNote(slug, pw, true);
      if (!mountedRef.current) return;
      applyNote(result.note);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setNeedsPassword(true);
        setLoadState("ready");
        if (err.code === "PASSWORD_INVALID") setGateError("密码不正确，请重新输入");
      } else if (err instanceof ApiError && err.status === 404) {
        setLoadState("missing");
      } else {
        setLoadState("error");
        setSaveError(err instanceof Error ? err.message : "加载失败");
      }
    }
  }, [applyNote, slug]);

  const saveNow = useCallback(async (force: boolean) => {
    if (savingRef.current || !note || needsPassword) return;
    const currentTitle = titleRef.current;
    const currentContent = contentRef.current;
    if (!force && currentTitle === baseline.current.title && currentContent === baseline.current.content) {
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    setSaveError("");
    try {
      const result = await api.updateNote(
        slug,
        {
          title: currentTitle,
          content: currentContent,
          ...(force ? {} : { version: versionRef.current }),
        },
        passwordRef.current,
      );
      if (!mountedRef.current) return;
      const next = result.note;
      baseline.current = { title: next.title, content: next.content };
      versionRef.current = next.version;
      setNote(next);
      setLastSavedAt(Date.now());
      setConflict(null);
      const stillDirty = titleRef.current !== next.title || contentRef.current !== next.content;
      dirtyRef.current = stillDirty;
      setSaveState(stillDirty ? "idle" : "saved");
      addRecent(next);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setNeedsPassword(true);
        setGateError("登录状态已失效，请重新输入剪贴板密码");
        setSaveState("idle");
      } else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        const data = err.data as { currentVersion?: number; currentUpdatedAt?: number } | null;
        setConflict({ version: Number(data?.currentVersion) || 0, updatedAt: Number(data?.currentUpdatedAt) || Date.now() });
        setSaveState("conflict");
      } else {
        setSaveState("error");
        setSaveError(err instanceof Error ? err.message : "保存失败");
        dirtyRef.current = true;
      }
    } finally {
      savingRef.current = false;
    }
  }, [note, needsPassword, slug]);

  useEffect(() => {
    mountedRef.current = true;
    const statePassword = (location.state as { password?: string } | null)?.password || "";
    const initial = statePassword || readStoredPassword(slug);
    setNote(null);
    setPassword(initial);
    passwordRef.current = initial;
    setSaveState("idle");
    setSettingsOpen(false);
    setShareOpen(false);
    setConflict(null);
    setDeleteConfirm("");
    setNewPassword("");
    setRemovePassword(false);
    setExpiryChoice("keep");
    void loadNote(initial);
    return () => {
      mountedRef.current = false;
    };
    // location.state is intentionally read once per slug
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, loadNote]);

  useEffect(() => {
    if (note) document.title = `${note.title || note.slug} · ${settings.siteName}`;
  }, [note, settings.siteName]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  useEffect(() => {
    if (loadState !== "ready" || !note || needsPassword || conflict) {
      dirtyRef.current = false;
      return;
    }
    const dirty = title !== baseline.current.title || content !== baseline.current.content;
    dirtyRef.current = dirty;
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void saveNow(false);
    }, 900);
    return () => window.clearTimeout(timer);
    // saveNow is stable per note/password; including it would retrigger on save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, loadState, note, needsPassword, conflict]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function unlock(pw: string) {
    setGateLoading(true);
    setGateError("");
    try {
      const result = await api.getNote(slug, pw, true);
      setPassword(pw);
      passwordRef.current = pw;
      storePassword(slug, pw);
      applyNote(result.note);
      success("已解锁");
    } catch (err) {
      if (err instanceof ApiError && err.code === "PASSWORD_INVALID") setGateError("密码不正确，请重新输入");
      else setGateError(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setGateLoading(false);
    }
  }

  async function reloadFromCloud() {
    setConflict(null);
    setSaveState("idle");
    await loadNote(passwordRef.current);
  }

  async function forceOverwrite() {
    setConflict(null);
    await saveNow(true);
  }

  async function copyAll() {
    if (!content) {
      toastError("剪贴板是空的");
      return;
    }
    try {
      await copyText(content);
      success("全文已复制");
    } catch {
      toastError("复制失败，请手动选择文本");
    }
  }

  async function copyLink() {
    try {
      await copyText(noteUrl(slug));
      success("链接已复制");
    } catch {
      toastError("复制失败");
    }
  }

  async function nativeShare() {
    const url = noteUrl(slug);
    if (navigator.share) {
      try {
        await navigator.share({ title: title || slug, text: "来自云夹的剪贴板", url });
        return;
      } catch {
        // 用户取消时回退为复制链接
      }
    }
    await copyLink();
  }

  function download() {
    downloadText(content, `${slug}.txt`);
    success("文本已下载");
  }

  function openSettings() {
    setExpiryChoice("keep");
    setNewPassword("");
    setRemovePassword(false);
    setSettingsError("");
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!note || settingsSaving) return;
    setSettingsSaving(true);
    setSettingsError("");
    try {
      const body: {
        title: string;
        content: string;
        version: number;
        password?: string;
        setPassword?: string | null;
        expiresIn?: string;
      } = {
        title: titleRef.current,
        content: contentRef.current,
        version: versionRef.current,
        password: passwordRef.current,
      };
      if (expiryChoice !== "keep") body.expiresIn = expiryChoice;
      if (removePassword) body.setPassword = null;
      else if (newPassword) body.setPassword = newPassword;
      const result = await api.updateNote(slug, body, passwordRef.current);
      const next = result.note;
      baseline.current = { title: next.title, content: next.content };
      versionRef.current = next.version;
      titleRef.current = next.title;
      contentRef.current = next.content;
      setNote(next);
      setLastSavedAt(Date.now());
      setSaveState("saved");
      setConflict(null);
      dirtyRef.current = false;
      addRecent(next);
      if (removePassword) {
        setPassword("");
        passwordRef.current = "";
        storePassword(slug, "");
      } else if (newPassword) {
        setPassword(newPassword);
        passwordRef.current = newPassword;
        storePassword(slug, newPassword);
      }
      setSettingsOpen(false);
      success(removePassword ? "已移除访问密码" : newPassword ? "密码已更新" : "设置已保存");
    } catch (err) {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setSettingsError("内容刚在其他设备更新，请关闭设置后刷新页面再试");
      } else {
        setSettingsError(err instanceof Error ? err.message : "保存设置失败");
      }
    } finally {
      setSettingsSaving(false);
    }
  }

  async function removeNote() {
    if (!note || deleting) return;
    if (deleteConfirm !== note.slug) {
      setSettingsError("请输入完整的剪贴板名称以确认删除");
      return;
    }
    setDeleting(true);
    setSettingsError("");
    try {
      await api.deleteNote(slug, deleteConfirm, passwordRef.current);
      removeRecent(slug);
      storePassword(slug, "");
      success("剪贴板已删除");
      navigate("/", { replace: true });
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  if (needsPassword) {
    return <PasswordGate slug={slug} error={gateError} loading={gateLoading} onSubmit={unlock} />;
  }

  if (loadState === "loading") {
    return <div className="note-boot"><LoadingScreen label="正在打开剪贴板…" /></div>;
  }

  if (loadState === "missing") {
    return (
      <div className="state-page">
        <div className="container state-top"><Logo siteName={settings.siteName} /><ThemeToggle /></div>
        <div className="state-card">
          <span className="state-icon"><FileQuestion size={26} /></span>
          <p className="eyebrow">NOT FOUND / EXPIRED</p>
          <h1>这个剪贴板还不存在</h1>
          <p>它可能从未被创建，或者已经超过有效期被自动清理。</p>
          <div className="state-slug"><span>/n/</span>{slug}</div>
          <div className="state-actions">
            <Link to={`/?name=${encodeURIComponent(slug)}`} className="btn btn-primary"><Clipboard size={16} /> 用这个名字新建</Link>
            <Link to="/" className="btn btn-ghost"><ArrowLeft size={16} /> 返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !note) {
    return (
      <div className="state-page">
        <div className="container state-top"><Logo siteName={settings.siteName} /><ThemeToggle /></div>
        <div className="state-card">
          <span className="state-icon is-error"><AlertTriangle size={26} /></span>
          <h1>暂时打不开</h1>
          <p>{saveError || "网络似乎开了个小差，请稍后再试。"}</p>
          <button type="button" className="btn btn-primary" onClick={() => void loadNote(passwordRef.current)}>
            <RotateCcw size={16} /> 重新加载
          </button>
        </div>
      </div>
    );
  }

  const charCount = chars(content);
  const lineCount = lines(content);
  const isDirty = title !== baseline.current.title || content !== baseline.current.content;
  const saveLabel =
    saveState === "saving" ? "保存中…" :
    saveState === "saved" ? "已自动保存" :
    saveState === "error" ? "保存失败" :
    saveState === "conflict" ? "内容冲突" :
    isDirty ? "等待保存…" : "自动保存已开启";

  return (
    <div className={`note-page ${focusMode ? "is-focus" : ""}`}>
      <header className="note-header">
        <div className="container note-header-inner">
          <div className="note-header-left">
            <Logo siteName={settings.siteName} />
            <span className="note-header-divider" />
            <Link to="/" className="note-back"><ArrowLeft size={15} /> 首页</Link>
          </div>
          <div className="note-header-actions">
            <span className={`save-state is-${saveState}`}>
              {saveState === "saving" ? <Loader2 size={14} className="spin" /> :
               saveState === "saved" ? <CheckCircle2 size={14} /> :
               saveState === "error" || saveState === "conflict" ? <AlertTriangle size={14} /> :
               <span className="live-dot" />}
              {saveLabel}
              {lastSavedAt && saveState === "saved" && <em>· {formatDate(lastSavedAt)}</em>}
            </span>
            <button type="button" className="icon-btn note-focus-btn" onClick={() => setFocusMode((value) => !value)} title={focusMode ? "退出专注模式" : "专注模式"} aria-label="切换专注模式">
              {focusMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button type="button" className="btn btn-soft btn-sm note-share-btn" onClick={() => setShareOpen(true)}>
              <Share2 size={15} /> 分享
            </button>
            <button type="button" className="icon-btn" onClick={openSettings} aria-label="剪贴板设置" title="设置">
              <Settings2 size={18} />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container note-main">
        <div className="note-crumb">
          <span>剪贴板</span>
          <span className="crumb-slash">/</span>
          <code>{note.slug}</code>
          {note.protected && <span className="mini-badge"><LockKeyhole size={11} /> 加密</span>}
          {note.expiresAt && <span className="mini-badge"><Clock3 size={11} /> {expiryText(note.expiresAt)}</span>}
        </div>

        {conflict && (
          <div className="conflict-banner" role="alert">
            <div className="conflict-icon"><AlertTriangle size={19} /></div>
            <div className="conflict-copy">
              <strong>这份内容在另一台设备上更新了</strong>
              <p>为避免覆盖别人的修改，自动保存已暂停。你可以载入云端的最新版本，或用自己的版本覆盖。</p>
            </div>
            <div className="conflict-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reloadFromCloud()}><RotateCcw size={14} /> 载入云端</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void forceOverwrite()}><Save size={14} /> 保留我的</button>
            </div>
          </div>
        )}

        {saveState === "error" && (
          <div className="save-error" role="alert">
            <AlertTriangle size={16} />
            <span>{saveError || "保存失败，请检查网络。"}</span>
            <button type="button" className="text-btn" onClick={() => void saveNow(true)}>立即重试</button>
          </div>
        )}

        <div className="editor-layout">
          <section className="editor-panel">
            <input
              className="note-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => { if (isDirty) void saveNow(false); }}
              placeholder="无标题剪贴板"
              maxLength={120}
              aria-label="剪贴板标题"
              spellCheck={false}
            />
            <div className="editor-meta-row">
              <span><Clock3 size={13} /> 更新于 {timeAgo(note.updatedAt)}</span>
              <span className="editor-meta-right">
                <button type="button" className="text-btn" onClick={copyAll}><Copy size={13} /> 复制全文</button>
                <button type="button" className="text-btn" onClick={download}><Download size={13} /> 下载</button>
              </span>
            </div>
            <div className="editor-textarea-wrap">
              <textarea
                className="note-textarea"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onBlur={() => { if (isDirty) void saveNow(false); }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    void saveNow(false);
                  }
                }}
                placeholder="从这里开始写。内容会自动保存，换个设备打开同一个链接就能继续。"
                maxLength={settings.maxNoteLength}
                spellCheck={false}
                aria-label="剪贴板内容"
              />
            </div>
            <footer className="editor-footer">
              <span>{charCount.toLocaleString()} 字 · {lineCount} 行</span>
              <span>{formatBytes(note.size)}</span>
              <span className="editor-footer-right">
                {note.protected ? <><LockKeyhole size={12} /> 密码保护</> : <><Unlock size={12} /> 公开链接</>}
                <span className="dot-sep">·</span>
                {expiryText(note.expiresAt)}
              </span>
            </footer>
          </section>

          <aside className="note-sidebar">
            <div className="side-card">
              <div className="side-card-head"><span><Link2 size={14} /> 分享链接</span><span className="side-kicker">LINK</span></div>
              <div className="side-url" title={noteUrl(slug)}>{shortUrl(slug)}</div>
              <div className="side-actions">
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void copyLink()}><Copy size={14} /> 复制</button>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setShareOpen(true)}><QrCode size={14} /> 二维码</button>
              </div>
              <p className="side-hint">同一链接，任何设备打开即可继续编辑。</p>
            </div>

            <div className="side-card">
              <div className="side-card-head"><span><Type size={14} /> 详情</span><span className="side-kicker">INFO</span></div>
              <dl className="info-list">
                <div><dt><CalendarDays size={13} /> 创建</dt><dd>{formatFullDate(note.createdAt)}</dd></div>
                <div><dt><Clock3 size={13} /> 更新</dt><dd>{formatFullDate(note.updatedAt)}</dd></div>
                <div><dt><Hash size={13} /> 字数</dt><dd>{charCount.toLocaleString()} 字</dd></div>
                <div><dt><Eye size={13} /> 浏览</dt><dd>{note.views.toLocaleString()} 次</dd></div>
                <div><dt><KeyRound size={13} /> 隐私</dt><dd>{note.protected ? "密码保护" : "链接可见"}</dd></div>
                <div><dt><Clock3 size={13} /> 有效期</dt><dd>{expiryText(note.expiresAt)}</dd></div>
              </dl>
              <button type="button" className="btn btn-soft btn-block btn-sm" onClick={openSettings}><Settings2 size={14} /> 修改密码与有效期</button>
            </div>

            <div className="side-tip">
              <ShieldCheck size={16} />
              <p>不要把密码、证件或公司机密放在公开剪贴板里。需要时请开启访问密码。</p>
            </div>

            <div className="mobile-quick">
              <button type="button" className="btn btn-soft" onClick={() => void copyAll()}><Copy size={15} /> 复制</button>
              <button type="button" className="btn btn-soft" onClick={() => setShareOpen(true)}><Share2 size={15} /> 分享</button>
              <button type="button" className="btn btn-soft" onClick={openSettings}><MoreHorizontal size={15} /> 设置</button>
            </div>
          </aside>
        </div>
      </main>

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="分享这个剪贴板"
        subtitle="二维码和链接都指向同一份内容"
        size="sm"
      >
        <div className="share-modal">
          <div className="qr-card">
            <QRCodeSVG
              value={noteUrl(slug)}
              size={188}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#101828"
              title={`${slug} 的分享二维码`}
            />
          </div>
          <div className="share-url">{noteUrl(slug)}</div>
          <div className="share-actions">
            <button type="button" className="btn btn-soft" onClick={() => void copyLink()}><Copy size={15} /> 复制链接</button>
            <button type="button" className="btn btn-primary" onClick={() => void nativeShare()}><Share2 size={15} /> 系统分享</button>
          </div>
          <p className="share-note"><Smartphone size={13} /> 用手机相机扫码即可在另一台设备打开</p>
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="剪贴板设置"
        subtitle="修改会立即生效，内容也会同时保存"
        size="md"
      >
        <div className="settings-form">
          <div className="settings-section">
            <div className="settings-section-head"><span><Clock3 size={15} /> 有效期</span><span className="settings-current">{expiryText(note.expiresAt)}</span></div>
            <select value={expiryChoice} onChange={(event) => setExpiryChoice(event.target.value)}>
              <option value="keep">保持当前设置</option>
              <option value="1h">1 小时后过期</option>
              <option value="6h">6 小时后过期</option>
              <option value="1d">1 天后过期</option>
              <option value="3d">3 天后过期</option>
              <option value="7d">7 天后过期</option>
              <option value="30d">30 天后过期</option>
              <option value="never">永久保存</option>
            </select>
            <p className="field-hint">到期后内容会自动删除，无法恢复。</p>
          </div>

          <div className="settings-section">
            <div className="settings-section-head"><span><KeyRound size={15} /> 访问密码</span><span className="settings-current">{note.protected ? "已开启" : "未开启"}</span></div>
            {note.protected && (
              <label className="check-line">
                <input type="checkbox" checked={removePassword} onChange={(event) => setRemovePassword(event.target.checked)} />
                <span>移除访问密码，让链接公开可见</span>
              </label>
            )}
            {!removePassword && (
              <label className="field">
                <span>{note.protected ? "设置新密码（留空则保持不变）" : "添加访问密码（至少 4 位）"}</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={note.protected ? "不修改请留空" : "至少 4 个字符"}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
            )}
            <p className="field-hint">密码以 PBKDF2 哈希保存，忘记后无法找回。</p>
          </div>

          {settingsError && <div className="inline-alert is-error">{settingsError}</div>}

          <div className="settings-danger">
            <div>
              <strong><Trash2 size={14} /> 删除这个剪贴板</strong>
              <p>输入完整名称 <code>{note.slug}</code> 后删除，操作不可恢复。</p>
            </div>
            <div className="delete-row">
              <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder={note.slug} aria-label="确认剪贴板名称" />
              <button type="button" className="btn btn-danger btn-sm" disabled={deleting || deleteConfirm !== note.slug} onClick={() => void removeNote()}>
                {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} 删除
              </button>
            </div>
          </div>
        </div>
        <footer className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(false)}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => void saveSettings()} disabled={settingsSaving}>
            {settingsSaving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} 保存设置
          </button>
        </footer>
      </Modal>
    </div>
  );
}
