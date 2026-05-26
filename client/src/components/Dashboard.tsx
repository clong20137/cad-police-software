import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Protected, RoleBasedRender } from './Protected';
import { UserRole } from 'cad-shared';
import styles from './Dashboard.module.css';

export const Dashboard: React.FC = () => {
  const { user, logout, permissions } = useAuth();

  return (
    <div className={styles.container}>
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <h1>CAD Dispatch</h1>
        </div>
        <div className={styles.navRight}>
          <span className={styles.user}>{user?.name} ({user?.role})</span>
          <button onClick={logout} className={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </nav>

      <div className={styles.content}>
        <div className={styles.sidebar}>
          <nav className={styles.menu}>
            <h3>Navigation</h3>

            <Protected permission="view_dispatch">
              <a href="#dispatch" className={styles.menuItem}>
                📍 Active Dispatch
              </a>
            </Protected>

            <Protected permission="view_officers">
              <a href="#officers" className={styles.menuItem}>
                👮 Officers
              </a>
            </Protected>

            <Protected permission="view_reports">
              <a href="#reports" className={styles.menuItem}>
                📊 Reports
              </a>
            </Protected>

            <RoleBasedRender roles={[UserRole.ADMIN]}>
              <a href="#admin" className={styles.menuItem}>
                ⚙️ Administration
              </a>
            </RoleBasedRender>
          </nav>
        </div>

        <div className={styles.main}>
          <section className={styles.section}>
            <h2>Dashboard</h2>

            <div className={styles.card}>
              <h3>User Information</h3>
              <p><strong>Name:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Role:</strong> {user?.role}</p>
              <p><strong>Badge:</strong> {user?.badge || 'N/A'}</p>
              <p><strong>Permissions:</strong> {permissions.length}</p>
            </div>

            <Protected permission="view_dispatch">
              <div className={styles.card}>
                <h3>📍 Active Dispatch</h3>
                <p>No active dispatches at this time.</p>
              </div>
            </Protected>

            <Protected permission="create_dispatch">
              <div className={styles.card}>
                <h3>Create New Dispatch</h3>
                <button className={styles.primaryBtn}>+ New Dispatch</button>
              </div>
            </Protected>

            <Protected permission="manage_users">
              <div className={styles.card}>
                <h3>User Management</h3>
                <p>Admin-only section for managing system users.</p>
                <button className={styles.primaryBtn}>Manage Users</button>
              </div>
            </Protected>

            <RoleBasedRender roles={[UserRole.DISPATCHER, UserRole.ADMIN]}>
              <div className={styles.card}>
                <h3>Dispatcher Features</h3>
                <p>Quick access to dispatcher tools and features.</p>
              </div>
            </RoleBasedRender>

            <RoleBasedRender roles={[UserRole.ADMIN]}>
              <div className={styles.card}>
                <h3>System Administration</h3>
                <p>Administrative controls and system settings.</p>
              </div>
            </RoleBasedRender>
          </section>
        </div>
      </div>
    </div>
  );
};
