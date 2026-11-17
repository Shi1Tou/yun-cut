import { Loader2 } from "lucide-react";

export function LoadingScreen({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="loading-screen">
      <Loader2 className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
