import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { UrgentAlert } from '../../types/auth';

const severityClass: Record<UrgentAlert['severity'], string> = {
  Advisory: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100',
  Important: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
  Urgent: 'border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
  Critical: 'border-red-500 bg-red-600 text-white dark:border-red-300 dark:bg-red-700 dark:text-white'
};

export const UrgentAlertOverlay: React.FC<{
  alerts: UrgentAlert[];
  onAcknowledge: (alertId: string) => void;
}> = ({ alerts, onAcknowledge }) => {
  const alert = alerts[0];
  if (!alert) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1200] flex items-start justify-center bg-black/20 px-4 pt-6">
      <div role="alertdialog" aria-modal="true" className={`pointer-events-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-2xl ${severityClass[alert.severity]} animate-[dockModalIn_140ms_ease-out]`}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-white/20 ring-1 ring-current/20">
            <AlertTriangle size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-black/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.14em]">
                {alert.severity} Alert
              </span>
              {alerts.length > 1 && (
                <span className="rounded bg-black/10 px-2 py-0.5 text-[11px] font-black">
                  +{alerts.length - 1} more
                </span>
              )}
            </div>
            <h2 className="mt-2 text-lg font-black">{alert.title}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold opacity-90">{alert.message}</p>
            <p className="mt-3 text-xs font-bold opacity-75">
              {alert.createdByName ? `Sent by ${alert.createdByName}` : 'CAD alert'}{alert.audienceLabel ? ` - ${alert.audienceLabel}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded bg-white px-4 py-2 text-sm font-black text-slate-950 shadow hover:bg-slate-100"
        >
          <CheckCircle2 size={18} />
          Acknowledge
        </button>
      </div>
    </div>,
    document.body
  );
};
