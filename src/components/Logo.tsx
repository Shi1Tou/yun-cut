import { useId } from "react";
import { Link } from "react-router-dom";

export function Logo({ siteName = "云夹", compact = false }: { siteName?: string; compact?: boolean }) {
  const gradientId = useId().replace(/:/g, "");
  return (
    <Link to="/" className="brand" aria-label={`${siteName} 首页`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 44 44" role="img">
          <defs>
            <linearGradient id={gradientId} x1="4" y1="4" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3B82F6" />
              <stop offset="0.55" stopColor="#6366F1" />
              <stop offset="1" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="40" height="40" rx="13" fill={`url(#${gradientId})`} />
          <rect x="11" y="9" width="18" height="24" rx="5" fill="white" fillOpacity="0.28" transform="rotate(-8 20 21)" />
          <rect x="16" y="12" width="18" height="24" rx="5" fill="white" />
          <path d="M21 20h8M21 25h8M21 30h5" stroke="#4F46E5" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="brand-text">{siteName}</span>}
    </Link>
  );
}
