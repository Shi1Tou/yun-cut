import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "./Logo";
import { useSite } from "../contexts/SiteContext";

export function Footer() {
  const { settings } = useSite();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo siteName={settings.siteName} />
          <p>{settings.tagline || settings.description}</p>
          <span className="footer-note">基于 EdgeOne Pages 构建 · 数据存储于你自己的 KV 空间</span>
        </div>
        <div className="footer-col">
          <h4>产品</h4>
          <a href="/#features">特点</a>
          <a href="/#how">使用方式</a>
          <a href="/#faq">常见问题</a>
        </div>
        <div className="footer-col">
          <h4>入口</h4>
          <Link to="/">新建剪贴板</Link>
          <Link to="/admin">管理员后台</Link>
          <a href="https://pages.edgeone.ai" target="_blank" rel="noreferrer noopener">
            EdgeOne Pages <ArrowUpRight size={12} />
          </a>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} {settings.siteName} · 请勿存放违法或重要机密内容</span>
        <span>{settings.footerText || "Keep it simple. Keep it close."}</span>
      </div>
    </footer>
  );
}
