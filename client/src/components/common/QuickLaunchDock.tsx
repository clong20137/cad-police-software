import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Plus, Settings, Trash2, X } from 'lucide-react';
import { ModalShell } from './ModalShell';

export type QuickLaunchOption<T extends string> = {
  id: T;
  label: string;
  icon: React.ReactNode;
};

export type QuickLaunchExternalSlot = {
  type: 'external';
  label: string;
  url: string;
};

export type QuickLaunchSlot<T extends string> = T | QuickLaunchExternalSlot | null;

const isExternalSlot = <T extends string>(slot: QuickLaunchSlot<T>): slot is QuickLaunchExternalSlot =>
  Boolean(slot && typeof slot === 'object' && slot.type === 'external');

const externalUrl = (url: string): string => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export const QuickLaunchDock = <T extends string>({
  slots,
  options,
  activeItem,
  customizingSlot,
  badges = {},
  sidebarCollapsed = false,
  desktopLeftClass,
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
  sidebarCollapsed?: boolean;
  desktopLeftClass?: string;
  onOpen: (item: T) => void;
  onCustomize: (index: number | null) => void;
  onAssignSlot: (index: number, value: QuickLaunchSlot<T>) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}) => {
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<number | null>(null);
  const [externalLabel, setExternalLabel] = useState('');
  const [externalUrlText, setExternalUrlText] = useState('');
  const didDragRef = useRef(false);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (customizingSlot === null) {
      setExternalLabel('');
      setExternalUrlText('');
      return;
    }

    const slot = slots[customizingSlot];
    if (isExternalSlot(slot)) {
      setExternalLabel(slot.label);
      setExternalUrlText(slot.url);
    } else {
      setExternalLabel('');
      setExternalUrlText('');
    }
  }, [customizingSlot, slots]);

  const assignExternal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (customizingSlot === null || !externalLabel.trim() || !externalUrlText.trim()) return;
    onAssignSlot(customizingSlot, {
      type: 'external',
      label: externalLabel.trim(),
      url: externalUrlText.trim()
    });
  };

  const clearSlot = (index: number) => {
    onAssignSlot(index, null);
    setContextMenu(null);
  };

  const clearAllSlots = () => {
    slots.forEach((_, index) => onAssignSlot(index, null));
    setContextMenu(null);
    onCustomize(null);
  };

  return (
    <>
      <section className={`pointer-events-none fixed bottom-3 right-3 z-40 hidden select-none transition-all duration-200 md:block ${desktopLeftClass || (sidebarCollapsed ? 'left-24' : 'left-[19.5rem]')}`}>
        <div className="pointer-events-auto mx-auto w-fit max-w-full rounded-2xl border border-cad-line bg-white/90 p-2 text-cad-ink shadow-[0_16px_45px_rgba(15,23,42,0.22)] dark:border-slate-700 dark:bg-slate-950/90 dark:text-white">
          <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
            {slots.map((slot, index) => {
              const option = typeof slot === 'string' ? options.find((item) => item.id === slot) || null : null;
              const external = isExternalSlot(slot) ? slot : null;
              const visible = option || external;
              const label = option?.label || external?.label || 'Add';
              const badgeCount = option ? badges[option.id] || 0 : 0;
              const isActive = option ? activeItem === option.id : false;

              return (
                <div
                  key={`quick-launch-${index}`}
                  className="relative"
                  draggable={Boolean(visible)}
                  onDragStart={(event) => {
                    if (!visible) {
                      event.preventDefault();
                      return;
                    }
                    didDragRef.current = true;
                    setDraggingSlot(index);
                    onDragStart(index);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', String(index));
                  }}
                  onDragOver={(event) => {
                    if (draggingSlot === null || draggingSlot === index) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onDrop(index);
                    setDraggingSlot(null);
                  }}
                  onDragEnd={() => {
                    setDraggingSlot(null);
                    window.setTimeout(() => {
                      didDragRef.current = false;
                    }, 0);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ index, x: event.clientX, y: event.clientY });
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (didDragRef.current) return;
                      if (option) {
                        onOpen(option.id);
                        return;
                      }
                      if (external) {
                        window.open(externalUrl(external.url), '_blank', 'noopener,noreferrer');
                        return;
                      }
                      onCustomize(index);
                    }}
                    className={`flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-[10px] font-bold transition ${
                      visible
                        ? `${draggingSlot === index ? 'scale-95 opacity-50' : ''} ${
                            isActive
                              ? '-translate-y-1 border-cad-blue bg-blue-50 text-cad-blue shadow-md dark:bg-blue-950/70 dark:text-blue-200'
                              : 'border-slate-200 bg-white text-cad-ink shadow-sm hover:-translate-y-1 hover:border-cad-blue hover:text-cad-blue dark:border-slate-700 dark:bg-slate-900 dark:text-blue-100'
                          } cursor-grab active:cursor-grabbing`
                        : 'border-slate-300 bg-white/60 text-slate-400 hover:border-cad-blue hover:text-cad-blue dark:border-slate-700 dark:bg-slate-900/60'
                    }`}
                    aria-label={visible ? `Open ${label}` : `Customize slot ${index + 1}`}
                    title={label}
                  >
                    {option?.icon || (external ? <ExternalLink size={20} /> : <Plus size={22} />)}
                    <span className="max-w-14 truncate">{label}</span>
                  </button>

                  {isActive && <span className="absolute -bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cad-blue shadow" />}

                  {badgeCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white shadow">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}

                  {visible && (
                    <button
                      type="button"
                      onClick={() => onCustomize(index)}
                      className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-sm hover:bg-slate-200 hover:text-cad-blue dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      aria-label={`Change ${label} shortcut`}
                      title="Change shortcut"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {contextMenu && (
          <div
            className="pointer-events-auto fixed z-[70] min-w-40 overflow-hidden rounded border border-slate-200 bg-white p-1 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 180),
              top: Math.min(contextMenu.y, window.innerHeight - 96)
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => clearSlot(contextMenu.index)}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Trash2 size={15} />
              Remove
            </button>
            <button
              type="button"
              onClick={clearAllSlots}
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <X size={15} />
              Remove All
            </button>
          </div>
        )}
      </section>

      <section className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 md:hidden">
        <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-cad-line bg-white/95 p-2 text-cad-ink shadow-2xl dark:border-slate-700 dark:bg-slate-950/95 dark:text-white">
          {slots.slice(0, 8).map((slot, index) => {
            const option = typeof slot === 'string' ? options.find((item) => item.id === slot) || null : null;
            const external = isExternalSlot(slot) ? slot : null;
            const label = option?.label || external?.label || 'Add';
            return (
              <button
                key={`mobile-quick-${index}`}
                type="button"
                onClick={() => {
                  if (option) onOpen(option.id);
                  else if (external) window.open(externalUrl(external.url), '_blank', 'noopener,noreferrer');
                  else onCustomize(index);
                }}
                className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold ${
                  option && activeItem === option.id ? 'bg-blue-50 text-cad-blue dark:bg-blue-950' : 'bg-slate-50 dark:bg-slate-900'
                }`}
                title={label}
              >
                {option?.icon || (external ? <ExternalLink size={18} /> : <Settings size={18} />)}
                <span className="max-w-full truncate px-1">{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <ModalShell
        title={customizingSlot === null ? '' : `Customize Slot ${customizingSlot + 1}`}
        open={customizingSlot !== null}
        onClose={() => onCustomize(null)}
        maxWidthClass="max-w-lg"
        placement="bottom"
      >
        {customizingSlot !== null && (
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((option) => {
                const alreadyUsed = slots.some((slot, index) => index !== customizingSlot && slot === option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={alreadyUsed}
                    onClick={() => onAssignSlot(customizingSlot, option.id)}
                    className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3 text-left text-sm font-semibold hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800 dark:disabled:bg-slate-950"
                  >
                    <span className="text-cad-blue">{option.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {alreadyUsed && <span className="text-xs text-slate-400">Added</span>}
                  </button>
                );
              })}
            </div>

            <form onSubmit={assignExternal} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                <ExternalLink size={17} />
                External Site
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                <input
                  value={externalLabel}
                  onChange={(event) => setExternalLabel(event.target.value)}
                  placeholder="Name"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <input
                  value={externalUrlText}
                  onChange={(event) => setExternalUrlText(event.target.value)}
                  placeholder="https://example.com"
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <button type="submit" className="inline-flex items-center justify-center rounded-md bg-cad-blue px-3 py-2 text-white">
                  <Plus size={16} />
                </button>
              </div>
            </form>

            <button
              type="button"
              onClick={() => onAssignSlot(customizingSlot, null)}
              className="flex items-center gap-3 rounded-md border border-red-200 px-3 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              <Trash2 size={18} />
              Clear this box
            </button>
          </div>
        )}
      </ModalShell>
    </>
  );
};
