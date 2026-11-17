import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Clock3,
  Copy,
  FileText,
  Globe2,
  Link2,
  Loader2,
  LockKeyhole,
  MonitorSmartphone,
  MousePointerClick,
  Plus,
  ShieldCheck,
  Shuffle,
  Smartphone,
  Sparkles,
  TimerReset,
  Trash2,
  WandSparkles,
  Zap,
} from "lucide-react";

import { api, ApiError } from "../lib/api";
import { useSite } from "../contexts/SiteContext";
import { getRecent, isValidSlug, randomSlug, removeRecent, type RecentNote } from "../lib/utils";
import type { ExpiryValue } from "../lib/types";
import { useToast } from "../contexts/ToastContext";

const FEATURES = [
  {
    icon: Zap,
    title: "即写即存",
    body: "输入停顿片刻，内容就会自动保存。没有保存按钮，也没有等待转圈。",
  },
  {
    icon: MonitorSmartphone,
    title: "跨设备继续",
    body: "电脑上写下开头，手机上打开同一个链接，从光标处接着写。",
  },
  {
    icon: ShieldCheck,
    title: "隐私可加锁",
    body: "给单个剪贴板设置访问密码，或让它在一段时间后自动过期。",
  },
  {
    icon: Link2,
    title: "链接就是全部",
    body: "不需要注册、不需要安装 App。一个短链接，发给任何设备都能打开。",
  },
  {
    icon: Trash2,
    title: "随时可删除",
    body: "内容只存在你的 EdgeOne KV 空间里，管理员和知道密码的人都能删除。",
  },
  {
    icon: WandSparkles,
    title: "极简但不简陋",
    body: "深色模式、二维码分享、字数统计、冲突提醒，该有的都有。",
  },
];

const FAQS = [
  {
    q: "需要注册账号吗？",
    a: "不需要。打开首页，写下内容，起一个名字，就会得到一条专属链接。你可以在任何设备上打开这条链接继续编辑。",
  },
  {
    q: "数据保存在哪里？",
    a: "部署在 EdgeOne Pages 时，内容保存在你自己绑定的 EdgeOne KV 命名空间中，不经过第三方。EdgeOne KV 为最终一致性，不同边缘节点之间最长可能有约 60 秒的同步延迟。",
  },
  {
    q: "别人知道链接就能看到吗？",
    a: "是的，默认情况下链接就是访问凭证。涉及隐私的内容请开启访问密码；密码只以 PBKDF2 哈希形式保存，无法找回。",
  },
  {
    q: "忘记剪贴板密码怎么办？",
    a: "密码不会明文保存，也不提供找回。可以请管理员在后台删除该剪贴板后重新创建。",
  },
  {
    q: "可以传文件或图片吗？",
    a: "当前版本专注于文字。图片和文件会显著增加存储与流量成本，也会让产品变得不再轻巧。",
  },
  {
    q: "为什么有时另一台设备看不到刚写的内容？",
    a: "EdgeOne KV 是最终一致性存储，跨节点同步最长约 60 秒。稍等片刻刷新即可；同一节点上的读写通常是即时的。",
  },
];

function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden="true">
      <div className="preview-window">
        <div className="preview-bar">
          <span className="window-dots"><i /><i /><i /></span>
          <span className="preview-url">yunclip.app/n/design-notes</span>
          <span className="preview-live"><span className="live-dot" /> 已保存</span>
        </div>
        <div className="preview-title">周五的产品草稿</div>
        <div className="preview-lines">
          <p>把「复制」这件事，做得再轻一点。</p>
          <p>1. 打开就能写，不打断思路</p>
          <p>2. 换设备时，链接还在原地</p>
          <p className="preview-cursor">3. 只留下真正重要的内容<span className="caret" /></p>
        </div>
        <div className="preview-footer">
          <span>326 字</span>
          <span className="preview-chip"><LockKeyhole size={12} /> 已加密</span>
        </div>
      </div>
      <div className="float-card float-card-a">
        <Smartphone size={16} />
        <div><strong>手机已同步</strong><span>刚刚</span></div>
      </div>
      <div className="float-card float-card-b">
        <Copy size={15} />
        <span>链接已复制</span>
      </div>
    </div>
  );
}

export function HomePage() {
  const { settings, stats, loading: siteLoading } = useSite();
  const { success } = useToast();
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryValue>("never");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [slugError, setSlugError] = useState("");
  const [recent, setRecent] = useState<RecentNote[]>([]);
  const expiryTouched = useRef(false);

  useEffect(() => {
    setRecent(getRecent());
    const name = new URLSearchParams(window.location.search).get("name");
    if (name) setSlug(name);
  }, []);

  useEffect(() => {
    document.title = `${settings.siteName} · 在线云剪贴板`;
  }, [settings.siteName]);

  useEffect(() => {
    if (!expiryTouched.current) setExpiry(settings.defaultExpiry);
  }, [settings.defaultExpiry]);

  function pickExpiry(value: ExpiryValue) {
    expiryTouched.current = true;
    setExpiry(value);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (submitting || !settings.allowCreate) return;
    setError("");
    setSlugError("");
    const cleanSlug = slug.trim();
    if (cleanSlug && !isValidSlug(cleanSlug)) {
      setSlugError("只能使用文字、数字、下划线和短横线，最多 32 个字符");
      return;
    }
    if (content.length > settings.maxNoteLength) {
      setError(`内容超过 ${settings.maxNoteLength.toLocaleString()} 个字符限制`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createNote({
        slug: cleanSlug || undefined,
        content,
        password: showPassword && password ? password : undefined,
        expiresIn: expiry,
      });
      if (result.note.protected && password) {
        try {
          sessionStorage.setItem(`yunclip.pw.${result.note.slug}`, password);
        } catch {
          // ignore
        }
      }
      setRecent(getRecent());
      success("剪贴板已创建，链接可以分享了");
      navigate(`/n/${encodeURIComponent(result.note.slug)}`, { replace: false });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.code === "SLUG_TAKEN" || apiError?.code === "SLUG_RESERVED") {
        setSlugError(apiError.message);
      } else {
        setError(err instanceof Error ? err.message : "创建失败，请稍后再试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function forgetRecent(target: RecentNote) {
    setRecent(removeRecent(target.slug));
  }

  return (
    <main>
      {settings.announcement && (
        <div className="announcement">
          <div className="container"><Sparkles size={14} /> {settings.announcement}</div>
        </div>
      )}

      <section className="hero">
        <div className="hero-glow hero-glow-a" />
        <div className="hero-glow hero-glow-b" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow"><span className="live-dot" /> 免登录 · 跨设备 · 即写即达</span>
            <h1>
              文字留在云端，
              <br />
              <span className="gradient-text">灵感跟着你走。</span>
            </h1>
            <p className="hero-lead">
              {settings.description}
              <br />
              一个名字，一条链接，就是你的跨设备剪贴板。
            </p>
            <div className="hero-actions">
              <a href="#create" className="btn btn-primary btn-lg">
                <Plus size={18} /> 立即新建
              </a>
              <a href="#how" className="btn btn-ghost btn-lg">
                看看怎么用 <ArrowRight size={16} />
              </a>
            </div>
            <div className="hero-stats">
              <div><strong>{siteLoading ? "…" : stats.notes.toLocaleString()}</strong><span>个剪贴板已创建</span></div>
              <span className="stat-divider" />
              <div><strong>0</strong><span>元起步，无需服务器</span></div>
              <span className="stat-divider" />
              <div><strong>60s</strong><span>全球边缘同步</span></div>
            </div>
            {recent.length > 0 && (
              <div className="recent-notes">
                <span className="recent-label"><Clock3 size={13} /> 最近打开</span>
                <div className="recent-list">
                  {recent.map((item) => (
                    <span className="recent-chip" key={item.slug}>
                      <Link to={`/n/${encodeURIComponent(item.slug)}`}>
                        <FileText size={13} />
                        {item.title || item.slug}
                      </Link>
                      <button type="button" onClick={() => forgetRecent(item)} aria-label={`从最近列表移除 ${item.slug}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="hero-visual">
            <HeroPreview />
          </div>
        </div>
      </section>

      <section className="create-section" id="create">
        <div className="container create-wrap">
          <div className="section-heading">
            <span className="eyebrow">CREATE IN SECONDS</span>
            <h2>现在，写点什么</h2>
            <p>不登录、不下载。名字留空就自动生成一条随机链接。</p>
          </div>
          <form
            className="create-card"
            onSubmit={create}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.requestSubmit();
              }
            }}
          >
            <div className="create-card-head">
              <div>
                <span className="mini-label">NEW CLIPBOARD</span>
                <h3>新建一个云夹</h3>
              </div>
              <span className="save-hint"><span className="live-dot" /> 自动保存</span>
            </div>

            <textarea
              className="create-textarea"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={"粘贴一段文字，或从这里开始写…\n\n例如：\n· 会议纪要\n· 代码片段\n· 待发送的消息"}
              maxLength={settings.maxNoteLength}
              rows={7}
              aria-label="剪贴板初始内容"
            />
            <div className="create-counter">
              <span>{content.length.toLocaleString()} / {settings.maxNoteLength.toLocaleString()}</span>
              <span>{content ? "按 Ctrl / ⌘ + Enter 快速创建" : "支持中文、代码和长文本"}</span>
            </div>

            <div className="create-name-row">
              <label className="name-field">
                <span className="name-prefix">/n/</span>
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setSlugError("");
                  }}
                  placeholder="给剪贴板起个名字（可留空）"
                  maxLength={32}
                  spellCheck={false}
                  aria-label="剪贴板名称"
                />
              </label>
              <button
                type="button"
                className="btn btn-soft random-btn"
                onClick={() => { setSlug(randomSlug()); setSlugError(""); }}
                title="随机生成一个名字"
              >
                <Shuffle size={16} /> 随机
              </button>
            </div>
            {slugError && <p className="form-error">{slugError}</p>}

            <div className="create-options">
              <button type="button" className="text-btn" onClick={() => setShowAdvanced((value) => !value)}>
                <Sparkles size={14} /> {showAdvanced ? "收起选项" : "密码、有效期"}
              </button>
              <div className="option-badges">
                <button type="button" className={`option-badge ${showPassword ? "is-on" : ""}`} onClick={() => { setShowPassword((value) => !value); setShowAdvanced(true); }}>
                  <LockKeyhole size={13} /> {showPassword ? "已开启密码" : "加个密码"}
                </button>
                <span className="option-badge"><TimerReset size={13} /> {expiry === "never" ? "永久保存" : `${expiry} 后过期`}</span>
              </div>
            </div>

            {showAdvanced && (
              <div className="advanced-panel">
                {showPassword && (
                  <label className="field">
                    <span>访问密码</span>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="至少 4 个字符，请自行记牢"
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </label>
                )}
                <label className="field">
                  <span>有效期</span>
                  <select value={expiry} onChange={(event) => pickExpiry(event.target.value as ExpiryValue)}>
                    <option value="never">永久保存</option>
                    <option value="1h">1 小时后</option>
                    <option value="6h">6 小时后</option>
                    <option value="1d">1 天后</option>
                    <option value="3d">3 天后</option>
                    <option value="7d">7 天后</option>
                    <option value="30d">30 天后</option>
                  </select>
                </label>
              </div>
            )}

            {!settings.allowCreate && (
              <div className="inline-alert">
                <LockKeyhole size={16} /> 管理员暂时关闭了新建入口。已有剪贴板仍然可以打开和编辑。
              </div>
            )}
            {error && <div className="inline-alert is-error">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block btn-lg create-submit" disabled={submitting || !settings.allowCreate}>
              {submitting ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
              {submitting ? "正在创建…" : "创建并开始记录"}
            </button>
            <p className="create-fineprint">
              创建即表示你同意仅存放自己的内容，不存储违法、涉密或敏感信息。
            </p>
          </form>
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">WHY YUNCLIP</span>
            <h2>把「复制粘贴」变成一条链接</h2>
            <p>没有复杂的协作空间，没有多余的账户体系。只是一块随时都在的云端剪贴板。</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-icon"><feature.icon size={20} /></span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-soft" id="how">
        <div className="container how-grid">
          <div className="how-copy">
            <span className="eyebrow">HOW IT WORKS</span>
            <h2>三步，开始跨设备</h2>
            <p>不需要理解「边缘计算」或「KV 存储」，你只需要写下第一行字。</p>
            <ol className="steps">
              <li>
                <span className="step-num">01</span>
                <div><strong>写下内容，起个名字</strong><p>名字会成为链接的一部分，例如 <code>/n/todo</code>。</p></div>
              </li>
              <li>
                <span className="step-num">02</span>
                <div><strong>把链接发到另一台设备</strong><p>微信、AirDrop、备忘录，任何能传链接的地方都可以。</p></div>
              </li>
              <li>
                <span className="step-num">03</span>
                <div><strong>打开，继续编辑</strong><p>内容自动保存。最多 32 个字符的名字，足够好记。</p></div>
              </li>
            </ol>
          </div>
          <div className="showcase">
            <div className="showcase-window">
              <div className="showcase-top">
                <span className="window-dots"><i /><i /><i /></span>
                <span className="showcase-path">/n/weekend-plan</span>
                <span className="showcase-status"><Check size={12} /> 已保存</span>
              </div>
              <div className="showcase-body">
                <div className="showcase-title">周末计划</div>
                <div className="showcase-text">
                  <p>周六上午：去河边散步，顺便买咖啡豆。</p>
                  <p>下午：把上次没读完的书读完。</p>
                  <p>晚上：给家里打个电话。</p>
                  <p className="showcase-muted">周日：什么都不安排。</p>
                </div>
                <div className="showcase-toolbar">
                  <span><Globe2 size={13} /> 永久保存</span>
                  <span><Copy size={13} /> 复制全文</span>
                  <span><Smartphone size={13} /> 手机同步</span>
                </div>
              </div>
            </div>
            <div className="showcase-badge"><MousePointerClick size={15} /> 打开链接就能编辑</div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="container faq-wrap">
          <div className="section-heading">
            <span className="eyebrow">QUESTIONS</span>
            <h2>你可能想知道</h2>
            <p>如果还有疑问，部署文档里有更完整的说明。</p>
          </div>
          <div className="faq-list">
            {FAQS.map((item) => (
              <details className="faq-item" key={item.q}>
                <summary>{item.q}<span className="faq-plus">+</span></summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container cta-inner">
          <div>
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h2>下一段文字，从一次点击开始。</h2>
            <p>无需注册，链接即用。你的数据，留在你自己的部署里。</p>
          </div>
          <a href="#create" className="btn btn-light btn-lg">
            <Plus size={18} /> 新建剪贴板
          </a>
        </div>
      </section>
    </main>
  );
}
