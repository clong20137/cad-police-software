import React from 'react';
import { ChevronLeft, ChevronRight, LucideIcon, Shield, UserCircle } from 'lucide-react';
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

const userInitials = (user?: User | null): string => {
  const source = user?.name || user?.email || user?.badge || 'CAD';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

export const ShieldSidebar: React.FC<{
  title: string;
  subtitle: string;
  user?: User | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  items: ShieldSidebarItem[];
  bottomContent?: React.ReactNode;
  footerItems?: ShieldSidebarItem[];
  onProfile?: () => void;
}> = ({ title, subtitle, user, collapsed, onToggleCollapsed, items, bottomContent, footerItems = [], onProfile }) => (
  <aside
    className={`relative hidden h-[100dvh] shrink-0 overflow-visible bg-cad-blue text-white shadow-xl transition-all duration-200 md:block ${
      collapsed ? 'w-20' : 'w-72'
    }`}
  >
    <button
      type="button"
      onClick={onToggleCollapsed}
      className="absolute -right-5 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-cad-line bg-white text-cad-blue shadow-lg hover:bg-slate-50 md:flex"
      aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
    >
      {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
    </button>

    <div className="shield-sidebar flex h-[100dvh] flex-col overflow-y-auto overflow-x-hidden">
      <div className="flex h-16 shrink-0 items-center border-b border-white/10 px-4">
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded bg-white text-cad-blue">
              <Shield size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-wider text-white">{title}</h1>
              <p className="truncate text-xs text-blue-100">{subtitle}</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded bg-white text-cad-blue">
            <Shield size={22} />
          </div>
        )}
      </div>

      <div className={collapsed ? 'px-3 py-3' : 'px-4 py-3'}>
        <button
          type="button"
          onClick={onProfile}
          className={`w-full overflow-hidden rounded bg-white/10 text-left transition hover:bg-white/15 ${
            collapsed ? 'p-1.5' : 'p-2.5'
          }`}
          title={user?.name || 'Open profile'}
        >
          <div className={collapsed ? 'flex justify-center' : 'flex items-center gap-3'}>
            <div
              className={`flex shrink-0 items-center justify-center rounded-full border border-white bg-white font-bold text-cad-blue shadow ${
                collapsed ? 'h-10 w-10 text-sm' : 'h-12 w-12 text-base'
              }`}
            >
              {user ? userInitials(user) : <UserCircle size={32} />}
            </div>
            {!collapsed && (
              <div className="min-w-0 text-white">
                <p className="text-[11px] uppercase tracking-[0.14em] text-blue-100">Profile</p>
                <p className="truncate text-sm font-bold">{user?.name || 'CAD User'}</p>
                <p className="truncate text-xs text-blue-100">{user?.email || user?.role || 'Signed in'}</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="mt-2 rounded bg-black/15 px-3 py-1.5 text-xs font-semibold text-white">
              {user?.cadUnitNumber || user?.unitNumber || user?.badge || user?.role || 'CAD'}
            </div>
          )}
        </button>
      </div>

      <nav className="flex shrink-0 flex-col gap-1.5 px-3 py-2">
        {items.map((item) => (
          <SidebarButton key={item.id} item={item} compact={collapsed} />
        ))}
      </nav>

      <div className="flex-1" />

      {bottomContent && (
        <div className={`shrink-0 ${collapsed ? 'px-3 py-3' : 'px-4 py-3'}`}>
          {bottomContent}
        </div>
      )}

      {footerItems.length > 0 && (
        <nav className={`shrink-0 border-t border-white/10 py-3 ${collapsed ? 'px-3' : 'px-4'}`}>
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
      className={`relative flex h-10 items-center rounded px-3 text-sm font-semibold transition ${
        compact ? 'justify-center' : 'justify-start'
      } ${item.active ? 'bg-white text-cad-blue shadow' : 'text-blue-50 hover:bg-white/10'}`}
      title={compact ? item.label : undefined}
    >
      <Icon className={compact ? '' : 'mr-3'} size={19} />
      {!compact && <span className="truncate">{item.label}</span>}
      {item.badge ? (
        <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-cad-alert px-1 text-[10px] font-bold text-white">
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      ) : null}
    </button>
  );
};
