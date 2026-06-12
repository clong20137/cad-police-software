import React, { CSSProperties, FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';

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
const pickerWidth = 288;
const pickerViewportGutter = 12;

export const QuickLaunchDock = <T extends string>({
  slots,
  options,
  activeItem,
  customizingSlot,
  badges = {},
  sidebarCollapsed = false,
  desktopLeftClass,
  dockAction,
  dockActions,
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
  dockAction?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    iconOnly?: boolean;
  };
  dockActions?: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    iconOnly?: boolean;
  }>;
  onOpen: (item: T) => void;
  onCustomize: (index: number | null) => void;
  onAssignSlot: (index: number, value: QuickLaunchSlot<T>) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
}) => {
  const resolvedDockActions = dockActions || (dockAction ? [dockAction] : []);
  const primaryDockAction = resolvedDockActions[0] || null;
  const stackedDockActions = resolvedDockActions.slice(1, 3);
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<number | null>(null);
  const [externalLabel, setExternalLabel] = useState('');
  const [externalUrlText, setExternalUrlText] = useState('');
  const [renderedCustomizeSlot, setRenderedCustomizeSlot] = useState<number | null>(customizingSlot);
  const [customizeMenuClosing, setCustomizeMenuClosing] = useState(false);
  const [customizeMenuPosition, setCustomizeMenuPosition] = useState<{ left: number; top: number; arrowLeft: number } | null>(null);
  const didDragRef = useRef(false);
  const customizeMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopSlotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const mobileSlotRefs = useRef<Array<HTMLDivElement | null>>([]);

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
    if (customizingSlot !== null) {
      setRenderedCustomizeSlot(customizingSlot);
      setCustomizeMenuClosing(false);
      return;
    }

    if (renderedCustomizeSlot === null) return;

    setCustomizeMenuClosing(true);
    const timeout = window.setTimeout(() => {
      setRenderedCustomizeSlot(null);
      setCustomizeMenuClosing(false);
      setExternalLabel('');
      setExternalUrlText('');
    }, 140);

    return () => window.clearTimeout(timeout);
  }, [customizingSlot, renderedCustomizeSlot]);

  useEffect(() => {
    if (customizingSlot === null) return;

    const slot = slots[customizingSlot];
    if (isExternalSlot(slot)) {
      setExternalLabel(slot.label);
      setExternalUrlText(slot.url);
    } else {
      setExternalLabel('');
      setExternalUrlText('');
    }
  }, [customizingSlot, slots]);

  useEffect(() => {
    if (renderedCustomizeSlot === null) return undefined;

    const closeFromPointer = (event: MouseEvent) => {
      const menuRect = customizeMenuRef.current?.getBoundingClientRect();
      if (
        menuRect &&
        event.clientX >= menuRect.left &&
        event.clientX <= menuRect.right &&
        event.clientY >= menuRect.top &&
        event.clientY <= menuRect.bottom
      ) {
        return;
      }

      if (customizeMenuRef.current?.contains(event.target as Node)) return;
      onCustomize(null);
    };
    const closeFromScroll = (event: Event) => {
      if (event.target instanceof Node && customizeMenuRef.current?.contains(event.target)) return;
      onCustomize(null);
    };

    window.addEventListener('mousedown', closeFromPointer);
    window.addEventListener('scroll', closeFromScroll, true);
    return () => {
      window.removeEventListener('mousedown', closeFromPointer);
      window.removeEventListener('scroll', closeFromScroll, true);
    };
  }, [onCustomize, renderedCustomizeSlot]);

  useLayoutEffect(() => {
    if (renderedCustomizeSlot === null) {
      setCustomizeMenuPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const desktopSlot = desktopSlotRefs.current[renderedCustomizeSlot];
      const mobileSlot = mobileSlotRefs.current[renderedCustomizeSlot];
      const desktopRect = desktopSlot?.getBoundingClientRect();
      const slot = desktopRect && desktopRect.width > 0 && desktopRect.height > 0 ? desktopSlot : mobileSlot;
      if (!slot) return;

      const rect = slot.getBoundingClientRect();
      const slotCenter = rect.left + rect.width / 2;
      const left = Math.min(
        Math.max(pickerViewportGutter, slotCenter - pickerWidth / 2),
        Math.max(pickerViewportGutter, window.innerWidth - pickerWidth - pickerViewportGutter)
      );

      setCustomizeMenuPosition({
        left,
        top: rect.top - 12,
        arrowLeft: slotCenter - left
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [renderedCustomizeSlot]);

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
    onCustomize(null);
  };

  const clearAllSlots = () => {
    slots.forEach((_, index) => onAssignSlot(index, null));
    setContextMenu(null);
    onCustomize(null);
  };

  const openContextMenu = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    onCustomize(null);
    setContextMenu({ index, x: event.clientX, y: event.clientY });
  };

  const openCustomizeMenu = (event: React.MouseEvent, index: number) => {
    event.stopPropagation();
    setContextMenu(null);
    onCustomize(customizingSlot === index ? null : index);
  };

  const renderCustomizeMenu = () => {
    if (renderedCustomizeSlot === null) return null;

    const animationClass = customizeMenuClosing ? 'quick-launch-picker-exit' : 'quick-launch-picker-enter pointer-events-auto';
    const style: CSSProperties | undefined = customizeMenuPosition
      ? {
          left: customizeMenuPosition.left,
          top: customizeMenuPosition.top,
          width: pickerWidth,
          transformOrigin: `${customizeMenuPosition.arrowLeft}px bottom`
        }
      : undefined;

    return (
      <div
        ref={customizeMenuRef}
        className={`${animationClass} fixed z-[75] rounded-md border border-cad-blue/20 bg-white p-2 text-cad-ink shadow-[0_22px_55px_rgba(15,23,42,0.28)] ring-1 ring-cad-blue/10 dark:border-blue-400/20 dark:bg-slate-900 dark:text-white`}
        style={style}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span
          className="absolute -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-cad-blue/20 bg-white dark:border-blue-400/20 dark:bg-slate-900"
          style={{ left: customizeMenuPosition?.arrowLeft ?? pickerWidth / 2 }}
        />
        <div className="relative grid max-h-72 gap-1 overflow-y-auto pr-1">
          {options.map((option) => {
            const alreadyUsed = slots.some((slot, slotIndex) => slotIndex !== renderedCustomizeSlot && slot === option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={alreadyUsed}
                onClick={() => onAssignSlot(renderedCustomizeSlot, option.id)}
                className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-cad-blue disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-blue-100 dark:disabled:bg-slate-950"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cad-blue/10 bg-blue-50 text-cad-blue dark:border-blue-300/10 dark:bg-blue-950/70 dark:text-blue-100">
                  {option.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {alreadyUsed && <span className="text-xs text-slate-400">Added</span>}
              </button>
            );
          })}
        </div>

        <form onSubmit={assignExternal} className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <ExternalLink size={14} />
            External Site
          </div>
          <div className="grid gap-2">
            <input
              value={externalLabel}
              onChange={(event) => setExternalLabel(event.target.value)}
              placeholder="Name"
              className="rounded border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-cad-blue focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={externalUrlText}
                onChange={(event) => setExternalUrlText(event.target.value)}
                placeholder="https://example.com"
                className="min-w-0 rounded border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-cad-blue focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                className="flex h-10 w-10 items-center justify-center rounded bg-cad-blue text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"
                disabled={!externalLabel.trim() || !externalUrlText.trim()}
                aria-label="Add external site"
                title="Add external site"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </form>

        <button
          type="button"
          onClick={() => clearSlot(renderedCustomizeSlot)}
          className="mt-2 flex w-full items-center gap-3 rounded px-2.5 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950"
        >
          <Trash2 size={16} />
          Remove
        </button>
      </div>
    );
  };

  return (
    <>
      <section className={`dispatch-quick-launch-enter pointer-events-none fixed bottom-4 right-3 z-40 hidden select-none transition-all duration-300 ease-out md:flex md:justify-end sm:right-5 ${desktopLeftClass || (sidebarCollapsed ? 'left-24' : 'left-[19.5rem]')}`}>
        <div className="pointer-events-auto flex h-[4.5rem] w-fit max-w-full items-center overflow-visible rounded-md border border-cad-blue/20 bg-white/95 p-2 text-cad-ink shadow-[0_18px_48px_rgba(15,23,42,0.28)] ring-1 ring-cad-blue/10 backdrop-blur-md dark:border-blue-400/20 dark:bg-slate-950/95 dark:text-white">
          <div className="flex max-w-full flex-nowrap items-center justify-center gap-2">
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
                  ref={(element) => {
                    desktopSlotRefs.current[index] = element;
                  }}
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
                  onContextMenu={(event) => openContextMenu(event, index)}
                >
                  <button
                    type="button"
                    onContextMenu={(event) => openContextMenu(event, index)}
                    onClick={(event) => {
                      if (didDragRef.current) return;
                      if (option) {
                        onOpen(option.id);
                        return;
                      }
                      if (external) {
                        window.open(externalUrl(external.url), '_blank', 'noopener,noreferrer');
                        return;
                      }
                      openCustomizeMenu(event, index);
                    }}
                    className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded border text-[10px] font-medium transition duration-200 ease-out hover:shadow-md ${
                      visible
                        ? `${draggingSlot === index ? 'scale-95 opacity-50' : ''} ${
                            isActive
                              ? 'border-cad-blue bg-blue-50 text-cad-blue shadow-md dark:bg-blue-950/70 dark:text-blue-200'
                              : 'border-slate-200 bg-white text-cad-ink shadow-sm hover:border-cad-blue/50 hover:bg-slate-50 hover:text-cad-blue dark:border-slate-700 dark:bg-slate-900 dark:text-blue-100 dark:hover:bg-slate-800'
                          } cursor-grab active:cursor-grabbing`
                        : 'border-slate-300 bg-white/60 text-slate-400 hover:border-cad-blue/50 hover:bg-slate-50 hover:text-cad-blue dark:border-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800'
                    }`}
                    aria-label={visible ? `Open ${label}` : `Customize slot ${index + 1}`}
                    title={label}
                  >
                    {option?.icon || (external ? <ExternalLink size={18} /> : <Plus size={20} />)}
                    <span className="max-w-10 truncate">{label}</span>
                  </button>

                  {isActive && <span className="absolute -bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cad-blue shadow" />}

                  {badgeCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-medium text-white shadow">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </span>
                  )}

                  {visible && (
                    <button
                      type="button"
                      onClick={(event) => openCustomizeMenu(event, index)}
                      className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-slate-500 shadow-sm hover:bg-slate-200 hover:text-cad-blue dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      aria-label={`Change ${label} shortcut`}
                      title="Change shortcut"
                    >
                      <Pencil size={10} />
                    </button>
                  )}

                </div>
              );
            })}
            {resolvedDockActions.length > 0 && (
              <>
                <div className="mx-1 h-10 w-px bg-cad-line dark:bg-slate-700" aria-hidden="true" />
                {primaryDockAction && (
                  <button
                    type="button"
                    onClick={primaryDockAction.onClick}
                    className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded border border-slate-200 bg-white text-[10px] font-medium text-cad-ink shadow-sm transition duration-200 ease-out hover:border-cad-blue/50 hover:bg-slate-50 hover:text-cad-blue hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-blue-100 dark:hover:bg-slate-800"
                    aria-label={primaryDockAction.label}
                    title={primaryDockAction.label}
                  >
                    {primaryDockAction.icon}
                    {!primaryDockAction.iconOnly && <span className="max-w-10 truncate">{primaryDockAction.label}</span>}
                  </button>
                )}
                {stackedDockActions.length > 0 && (
                  <div className="grid h-14 w-14 grid-rows-2 gap-1">
                    {stackedDockActions.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        onClick={action.onClick}
                        className="flex min-h-0 items-center justify-center rounded border border-slate-200 bg-white text-cad-ink shadow-sm transition duration-200 ease-out hover:border-cad-blue/50 hover:bg-slate-50 hover:text-cad-blue hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-blue-100 dark:hover:bg-slate-800"
                        aria-label={action.label}
                        title={action.label}
                      >
                        {action.icon}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </section>

      <section className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 md:hidden">
        <div className="pointer-events-auto grid grid-cols-4 gap-2 rounded-xl border border-cad-line bg-white/95 p-2 text-cad-ink shadow-2xl dark:border-slate-700 dark:bg-slate-950/95 dark:text-white">
          {slots.slice(0, 8).map((slot, index) => {
            const option = typeof slot === 'string' ? options.find((item) => item.id === slot) || null : null;
            const external = isExternalSlot(slot) ? slot : null;
            const label = option?.label || external?.label || 'Add';
            return (
              <div
                key={`mobile-quick-${index}`}
                className="relative"
                ref={(element) => {
                  mobileSlotRefs.current[index] = element;
                }}
                onContextMenu={(event) => openContextMenu(event, index)}
              >
                <button
                  type="button"
                  onContextMenu={(event) => openContextMenu(event, index)}
                  onClick={(event) => {
                    if (option) onOpen(option.id);
                    else if (external) window.open(externalUrl(external.url), '_blank', 'noopener,noreferrer');
                    else openCustomizeMenu(event, index);
                  }}
                  className={`flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold ${
                    option && activeItem === option.id ? 'bg-blue-50 text-cad-blue dark:bg-blue-950' : 'bg-slate-50 dark:bg-slate-900'
                  }`}
                  title={label}
                >
                  {option?.icon || (external ? <ExternalLink size={18} /> : <Plus size={18} />)}
                  <span className="max-w-full truncate px-1">{label}</span>
                </button>
              </div>
            );
          })}
          {resolvedDockActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-lg bg-slate-50 text-[10px] font-bold dark:bg-slate-900"
              title={action.label}
              aria-label={action.label}
            >
              {action.icon}
              {!action.iconOnly && <span className="max-w-full truncate px-1">{action.label}</span>}
            </button>
          ))}
        </div>
      </section>

      {renderCustomizeMenu()}

      {contextMenu && (
        <div
          className="pointer-events-auto fixed z-[80] min-w-40 overflow-hidden rounded border border-slate-200 bg-white p-1 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900"
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
    </>
  );
};
