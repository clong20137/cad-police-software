import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';

type ModalPlacement = 'center' | 'bottom';
type ModalPosition = { x: number; y: number };

const dragIgnoreSelector = 'button,a,input,select,textarea,label,[data-modal-drag-ignore="true"]';
const mobileBreakpoint = 768;

const isMobileViewport = () => window.innerWidth < mobileBreakpoint;

const clampPosition = (position: ModalPosition, width: number, height: number): ModalPosition => ({
  x: Math.min(Math.max(8, position.x), Math.max(8, window.innerWidth - width - 8)),
  y: Math.min(Math.max(8, position.y), Math.max(8, window.innerHeight - height - 8))
});

export const ModalShell: React.FC<{
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
  placement?: ModalPlacement;
  contentClassName?: string;
  resizable?: boolean;
  zIndex?: number;
  onFocus?: () => void;
}> = ({
  title,
  open,
  onClose,
  children,
  maxWidthClass = 'max-w-2xl',
  placement = 'center',
  contentClassName = 'p-4',
  resizable = true,
  zIndex = 50,
  onFocus
}) => {
  const windowRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<ModalPosition>({ x: 0, y: 0 });
  const [position, setPosition] = useState<ModalPosition>(() => ({ x: Math.max(16, window.innerWidth / 2 - 360), y: 96 }));
  const [isDragging, setIsDragging] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(() => isMobileViewport());

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    const syncLayout = () => {
      const nextIsMobile = isMobileViewport();
      setIsMobileLayout(nextIsMobile);
      if (nextIsMobile) {
        setIsDragging(false);
        return;
      }

      const width = windowRef.current?.offsetWidth || 720;
      const height = windowRef.current?.offsetHeight || 520;
      setPosition((current) => clampPosition(current, width, height));
    };

    syncLayout();
    window.addEventListener('resize', syncLayout);
    return () => window.removeEventListener('resize', syncLayout);
  }, []);

  useEffect(() => {
    if (!isDragging || isMobileLayout) return undefined;

    const onPointerMove = (event: PointerEvent) => {
      const width = windowRef.current?.offsetWidth || 720;
      const height = windowRef.current?.offsetHeight || 520;
      setPosition(clampPosition({
        x: event.clientX - dragOffsetRef.current.x,
        y: event.clientY - dragOffsetRef.current.y
      }, width, height));
    };
    const stopDragging = () => setIsDragging(false);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
    };
  }, [isDragging, isMobileLayout]);

  const startDragging = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isMobileLayout || placement === 'bottom') return;
    if ((event.target as HTMLElement).closest(dragIgnoreSelector)) return;
    onFocus?.();
    const rect = windowRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    setIsDragging(true);
  };

  if (!open) return null;

  const floatingStyle: CSSProperties | undefined =
    placement === 'center' && !isMobileLayout ? { left: position.x, top: position.y } : undefined;
  const shellPositionClass =
    placement === 'center' && !isMobileLayout
      ? 'items-start justify-start'
      : placement === 'center'
        ? 'items-center'
        : 'items-end';

  return (
    <div className={`pointer-events-none fixed inset-0 flex justify-center p-4 ${shellPositionClass}`} style={{ zIndex }}>
      <div
        ref={windowRef}
        className={`pointer-events-auto flex max-h-[calc(100vh-7rem)] w-full origin-bottom animate-[dockModalIn_160ms_ease-out] flex-col overflow-hidden rounded-lg border border-cad-line bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${
          placement === 'center' && !isMobileLayout ? `fixed ${isDragging ? 'cursor-grabbing' : ''}` : ''
        } ${resizable && placement === 'center' && !isMobileLayout ? 'resize min-h-[28rem] min-w-[36rem]' : ''} ${maxWidthClass}`}
        style={floatingStyle}
        onMouseDown={(event) => {
          event.stopPropagation();
          onFocus?.();
        }}
      >
        <div
          className={`flex shrink-0 items-center justify-between border-b border-cad-line p-4 dark:border-slate-700 ${
            placement === 'center' && !isMobileLayout ? 'cursor-grab select-none' : ''
          }`}
          onPointerDown={startDragging}
        >
          <div className="flex min-w-0 items-center gap-2">
            {placement === 'center' && !isMobileLayout && <GripHorizontal size={17} className="shrink-0 text-slate-400" />}
            <h2 className="truncate text-lg font-bold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        <div className={`min-h-0 overflow-auto ${contentClassName}`}>{children}</div>
      </div>
    </div>
  );
};
