import React from 'react';
import { GripVertical, Settings, X } from 'lucide-react';
import { ModalShell } from './ModalShell';

export type QuickLaunchOption<T extends string> = {
  id: T;
  label: string;
  icon: React.ReactNode;
};

export type QuickLaunchSlot<T extends string> = T | null;

export const QuickLaunchDock = <T extends string>({
  slots,
  options,
  activeItem,
  customizingSlot,
  badges = {},
  onOpen,
  onCustomize,
  onAssignSlot,
  onDragStart,
  onDrop
}: {
  slots: Array<QuickLaunchSlot<T>>;
  options: Array<QuickLaunchOption<T>>;
  activeItem: T | null;
  customizingSlot: number | null;
  badges?: Partial<Record<T, number>>;
  onOpen: (item: T) => void;
  onCustomize: (index: number | null) => void;
  onAssignSlot: (index: number, value: QuickLaunchSlot<T>) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}) => (
  <>
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
      <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-cad-line bg-white/95 p-2 text-cad-ink shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 dark:text-white md:grid-cols-8">
        {slots.map((slot, index) => {
          const item = options.find((option) => option.id === slot);
          const badgeCount = item ? badges[item.id] || 0 : 0;
          return (
            <div
              key={`quick-slot-${index}`}
              draggable
              onDragStart={() => onDragStart(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDrop(index)}
              className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-cad-ink transition hover:border-blue-200 hover:bg-blue-50 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
            >
              <GripVertical className="absolute left-1 top-1 text-slate-400 dark:text-white/45" size={12} />
              <button
                type="button"
                onClick={() => (item ? onOpen(item.id) : onCustomize(index))}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold ${
                  activeItem === item?.id ? 'text-cad-blue dark:text-blue-200' : ''
                }`}
                aria-label={item ? `Open ${item.label}` : `Customize slot ${index + 1}`}
              >
                {item?.icon || <Settings size={18} />}
                <span className="max-w-full truncate px-1">{item?.label || 'Empty'}</span>
              </button>
              {badgeCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-white dark:ring-slate-950">
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
              <button
                type="button"
                onClick={() => onCustomize(index)}
                className="absolute right-1 top-1 rounded bg-black/5 p-1 text-slate-500 hover:text-cad-ink dark:bg-white/10 dark:text-white/70 dark:hover:text-white"
                aria-label={`Customize slot ${index + 1}`}
              >
                <Settings size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>

    <ModalShell
      title={customizingSlot === null ? '' : `Customize Slot ${customizingSlot + 1}`}
      open={customizingSlot !== null}
      onClose={() => onCustomize(null)}
      maxWidthClass="max-w-lg"
      placement="bottom"
    >
      {customizingSlot !== null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onAssignSlot(customizingSlot, option.id)}
              className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-blue-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <span className="text-cad-blue">{option.icon}</span>
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAssignSlot(customizingSlot, null)}
            className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <X size={18} className="text-slate-500" />
            Empty
          </button>
        </div>
      )}
    </ModalShell>
  </>
);
