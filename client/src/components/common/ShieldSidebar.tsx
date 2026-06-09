import React from 'react';
import { LucideIcon, Menu } from 'lucide-react';
import { User } from '../../types/auth';

export interface ShieldSidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: number;
  iconClassName?: string;
  onClick: () => void;
}

export const ShieldSidebar: React.FC<{
  title: string;
  subtitle: string;
  user?: User | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  items: ShieldSidebarItem[];
  footerItems?: ShieldSidebarItem[];
  onProfile?: () => void;
}> = ({ title, subtitle, user, collapsed, onToggleCollapsed, items, footerItems = [], onProfile }) => (
  <aside
    className={`relative hidden h-[100dvh] shrink-0 overflow-visible bg-[#171717] text-white shadow-[12px_0_30px_rgba(0,0,0,0.28)] transition-all duration-200 md:block ${
      collapsed ? 'w-20' : 'w-52'
    }`}
  >
    <div className="shield-sidebar flex h-[100dvh] flex-col overflow-y-auto overflow-x-hidden">
      <div className="flex h-11 shrink-0 items-center border-b border-black bg-gradient-to-b from-zinc-700 to-black px-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white/5 text-white hover:bg-white/10"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Menu size={25} />
        </button>
        {!collapsed && (
          <div className="ml-2 min-w-0">
            <p className="truncate text-sm font-black uppercase tracking-wide text-white">{title}</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{subtitle}</p>
          </div>
        )}
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={onProfile}
          className={`group flex min-h-12 w-full items-center border border-black bg-gradient-to-b from-zinc-800 to-black text-left shadow-[inset_0_1px_rgba(255,255,255,0.12)] transition hover:from-zinc-700 hover:to-zinc-950 ${
            collapsed ? 'justify-center px-2' : 'gap-3 px-3'
          }`}
          title={user?.name || 'Change status'}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-amber-400 text-zinc-950 shadow">
            ★
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold uppercase text-white">CHNG STATUS</span>
              <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                {user?.cadUnitNumber || user?.unitNumber || user?.badge || user?.role || 'CAD'}
              </span>
            </span>
          )}
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-2 px-2 py-1">
        {items.map((item) => (
          <SidebarButton key={item.id} item={item} compact={collapsed} />
        ))}
      </nav>

      <div className="flex-1" />

      {footerItems.length > 0 && (
        <nav className="shrink-0 border-t border-zinc-800 px-2 py-3">
          {footerItems.map((item) => (
            <SidebarButton key={item.id} item={item} compact={collapsed} />
          ))}
        </nav>
      )}
    </div>
  </aside>
);

const SidebarButton: React.FC<{ item: ShieldSidebarItem; compact: boolean }> = ({ item, compact }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={item.onClick}
      className={`relative flex min-h-12 border border-black bg-gradient-to-b from-zinc-800 to-black text-sm font-semibold uppercase tracking-wide shadow-[inset_0_1px_rgba(255,255,255,0.12)] transition hover:from-zinc-700 hover:to-zinc-950 ${
        compact ? 'justify-center px-2' : 'items-center gap-3 px-3'
      } ${item.active ? 'ring-1 ring-cad-signal/70' : ''}`}
      title={compact ? item.label : undefined}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white text-cad-blue shadow ${item.iconClassName || ''}`}>
        <Icon size={19} />
      </span>
      {!compact && <span className="truncate">{item.label}</span>}
      {item.badge ? (
        <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-cad-alert px-1 text-[10px] font-bold text-white">
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      ) : null}
    </button>
  );
};
