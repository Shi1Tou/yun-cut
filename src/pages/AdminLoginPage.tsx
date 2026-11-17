import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useSite } from "../contexts/SiteContext";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";

export function AdminLoginPage() {
  const { settings } = useSite();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [configMissing, setConfigMissing] = useState(false);

  useEffect(() => {
    document.title = `管理员登录 · ${settings.siteName}`;
    let cancelled = false;
    api.adminSession()
      .then(() => { if (!cancelled) navigate("/admin", { replace: true }); })
      .catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [navigate, settings.siteName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setConfigMissing(false);
    setLoading(true);
    try {
      await api.adminLogin(username, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "ADMIN_NOT_CONFIGURED") {
        setConfigMissing(true);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "登录失败");
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return <div className="admin-login-boot"><Loader2 className="spin" size={22} /></div>;
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-visual-top">
          <Logo siteName={settings.siteName} />
          <ThemeToggle />
        </div>
        <div className="login-visual-copy">
          <span className="eyebrow"><Sparkles size={13} /> SINGLE ADMIN</span>
          <h1>一个后台，<br />看清每一块剪贴板。</h1>
          <p>查看内容、清理过期数据、调整站点规则。没有多余的账号体系，管理员身份只来自环境变量。</p>
          <div className="login-points">
            <div><ShieldCheck size={17} /><span>HttpOnly 签名会话</span></div>
            <div><LockKeyhole size={17} /><span>凭据不落库、不进代码</span></div>
            <div><KeyRound size={17} /><span>后台操作审计日志</span></div>
          </div>
        </div>
        <p className="login-visual-foot">ADMIN CONSOLE · {new Date().getFullYear()}</p>
      </div>

      <div className="login-form-side">
        <div className="login-form-top">
          <Link to="/" className="back-link"><ArrowLeft size={14} /> 返回站点</Link>
        </div>
        <form className="login-card" onSubmit={submit}>
          <span className="login-icon"><UserRound size={23} /></span>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>管理员登录</h2>
          <p className="login-desc">账号由 <code>ADMIN_USERNAME</code> 和 <code>ADMIN_PASSWORD</code> 环境变量决定。</p>

          <label className="field">
            <span>管理员账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              autoComplete="username"
              maxLength={80}
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入管理员密码"
                autoComplete="current-password"
                maxLength={128}
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error && (
            <div className={`inline-alert is-error ${configMissing ? "is-config" : ""}`}>
              {error}
              {configMissing && <span>请在部署平台的项目设置中添加环境变量，然后重新部署。</span>}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={loading || !username || !password}>
            {loading ? <Loader2 size={17} className="spin" /> : <LockKeyhole size={17} />}
            {loading ? "正在验证…" : "进入后台"}
          </button>
          <p className="login-note">连续输错会触发短时限制。登录状态默认保持 24 小时。</p>
        </form>
      </div>
    </div>
  );
}
