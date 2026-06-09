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
    className={`relative hidden h-[100dvh] shrink-0 overflow-visible border-r border-cad-line bg-white/95 text-cad-ink shadow-2xl transition-all duration-200 md:block ${
      collapsed ? 'w-20' : 'w-72'
    }`}
  >
    <div className="shield-sidebar flex h-[100dvh] flex-col overflow-y-auto overflow-x-hidden">
      <div className="flex min-h-16 shrink-0 items-center border-b border-cad-navy/20 bg-cad-navy px-3 text-white">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Menu size={22} />
        </button>
        {!collapsed && (
          <div className="ml-3 min-w-0">
            <p className="truncate text-base font-bold">{title}</p>
            <p className="truncate text-xs font-medium text-slate-300">{subtitle}</p>
          </div>
        )}
      </div>

      <div className="border-b border-cad-line p-3">
        <button
          type="button"
          onClick={onProfile}
          className={`group flex min-h-14 w-full items-center rounded-lg border border-cad-line bg-white text-left shadow-control transition hover:border-cad-blue/40 hover:bg-blue-50 ${
            collapsed ? 'justify-center px-2' : 'gap-3 px-3'
          }`}
          title={user?.name || 'Change status'}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cad-blue text-white shadow">
            <span aria-hidden="true" className="text-base font-black">S</span>
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-cad-ink">Change Status</span>
              <span className="block truncate text-xs font-medium text-slate-500">
                {user?.cadUnitNumber || user?.unitNumber || user?.badge || user?.role || 'CAD'}
              </span>
            </span>
          )}
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-2 px-3 py-3">
        {items.map((item) => (
          <SidebarButton key={item.id} item={item} compact={collapsed} />
        ))}
      </nav>

      <div className="flex-1" />

      {footerItems.length > 0 && (
        <nav className="shrink-0 border-t border-cad-line px-3 py-3">
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
      className={`relative flex min-h-12 rounded-lg border border-cad-line bg-white text-sm font-semibold text-slate-700 shadow-control transition hover:border-cad-blue/40 hover:bg-blue-50 hover:text-cad-blue ${
        compact ? 'justify-center px-2' : 'items-center gap-3 px-3'
      } ${item.active ? 'border-cad-blue bg-blue-50 text-cad-blue ring-1 ring-cad-blue/25' : ''}`}
      title={compact ? item.label : undefined}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-cad-blue ring-1 ring-slate-200 ${item.iconClassName || ''}`}>
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
