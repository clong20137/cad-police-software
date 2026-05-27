import React from 'react';
import { X } from 'lucide-react';

type ModalPlacement = 'center' | 'bottom';

export const ModalShell: React.FC<{
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
  placement?: ModalPlacement;
  contentClassName?: string;
}> = ({
  title,
  open,
  onClose,
  children,
  maxWidthClass = 'max-w-2xl',
  placement = 'center',
  contentClassName = 'p-4'
}) => {
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-slate-950/45 p-4 ${
        placement === 'center' ? 'items-center' : 'items-end'
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[calc(100vh-7rem)] w-full origin-bottom animate-[dockModalIn_160ms_ease-out] flex-col overflow-hidden rounded-lg border border-cad-line bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${maxWidthClass}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-cad-line p-4 dark:border-slate-700">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className={`min-h-0 overflow-auto ${contentClassName}`}>{children}</div>
      </div>
    </div>
  );
};
