import { Link } from "react-router-dom";
import { ArrowLeft, Compass, Plus } from "lucide-react";

export function NotFoundPage() {
  return (
    <main className="notfound-page">
      <div className="notfound-art" aria-hidden="true">
        <span>4</span><span className="notfound-zero"><Compass size={58} /></span><span>4</span>
      </div>
      <p className="eyebrow">OFF THE MAP</p>
      <h1>这里没有剪贴板</h1>
      <p>可能是链接拼错了，或者这条剪贴板已经被删除。</p>
      <div className="notfound-actions">
        <Link to="/" className="btn btn-primary"><Plus size={16} /> 新建一个</Link>
        <Link to="/" className="btn btn-ghost"><ArrowLeft size={16} /> 回到首页</Link>
      </div>
    </main>
  );
}
