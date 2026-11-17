import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useSite } from "../contexts/SiteContext";

export function PasswordGate({
  slug,
  error,
  loading,
  onSubmit,
}: {
  slug: string;
  error: string;
  loading: boolean;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { settings } = useSite();
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || loading) return;
    await onSubmit(password);
  }

  return (
    <div className="gate-page">
      <div className="gate-top container">
        <Logo siteName={settings.siteName} />
        <ThemeToggle />
      </div>
      <div className="gate-card">
        <span className="gate-icon"><KeyRound size={24} /></span>
        <p className="eyebrow">PRIVATE CLIPBOARD</p>
        <h1>这个剪贴板已加密</h1>
        <p className="gate-desc">
          <code>{slug}</code> 设置了访问密码。输入密码后即可查看和继续编辑。
        </p>
        <form onSubmit={submit} className="gate-form">
          <input type="text" name="username" value={slug} readOnly hidden autoComplete="username" aria-hidden="true" />
          <label htmlFor="note-password">访问密码</label>
          <input
            id="note-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="输入密码"
            autoFocus
            autoComplete="current-password"
            maxLength={128}
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={!password || loading}>
            {loading ? <Loader2 size={17} className="spin" /> : <KeyRound size={17} />}
            {loading ? "验证中…" : "解锁并进入"}
          </button>
        </form>
        <Link to="/" className="back-link"><ArrowLeft size={14} /> 返回首页</Link>
      </div>
    </div>
  );
}
