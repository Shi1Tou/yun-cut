import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, Plus, X } from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { useSite } from "../contexts/SiteContext";

export function Header() {
  const { settings } = useSite();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  if (location.pathname.startsWith("/admin")) return null;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Logo siteName={settings.siteName} />
        <nav className={`header-nav ${open ? "is-open" : ""}`} aria-label="主导航">
          <a href="/#features" onClick={() => setOpen(false)}>特点</a>
          <a href="/#how" onClick={() => setOpen(false)}>怎么用</a>
          <a href="/#faq" onClick={() => setOpen(false)}>常见问题</a>
          <Link to="/admin" className="header-admin" onClick={() => setOpen(false)}>管理</Link>
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <Link to="/" className="btn btn-primary btn-sm header-cta">
            <Plus size={16} />
            新建
          </Link>
          <button type="button" className="icon-btn header-menu" onClick={() => setOpen((value) => !value)} aria-label="打开菜单" aria-expanded={open}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
