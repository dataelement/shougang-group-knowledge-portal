import { CheckCircle, XCircle } from 'lucide-react';
import type { ActionToastState } from '../hooks/useActionToast';
import s from './ActionToast.module.css';

interface ActionToastProps {
  toast: ActionToastState;
}

export function ActionToast({ toast }: ActionToastProps) {
  if (!toast) return null;
  return (
    <div
      className={`${s.toast} ${toast.type === 'success' ? s.toastSuccess : s.toastError}`}
      role="alert"
      aria-live="assertive"
    >
      {toast.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
      <span>{toast.message}</span>
    </div>
  );
}
