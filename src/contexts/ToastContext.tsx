import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; message: string; kind: ToastKind }

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { id, message, kind }]);
      window.setTimeout(() => dismiss(id), 3600);
    },
    [dismiss],
  );

  const success = useCallback((message: string) => toast(message, "success"), [toast]);
  const error = useCallback((message: string) => toast(message, "error"), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div className="toast-stack" role="region" aria-label="通知">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`} role="status">
            <span className="toast-icon" aria-hidden="true">
              {item.kind === "success" ? <CheckCircle2 size={18} /> : item.kind === "error" ? <TriangleAlert size={18} /> : <Info size={18} />}
            </span>
            <span className="toast-message">{item.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="关闭通知">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
