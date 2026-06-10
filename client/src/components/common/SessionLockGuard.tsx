import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, LogOut, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { authClient } from '../../services/authClient';
import { APP_NAME } from '../../constants/branding';
import { sessionTimeoutMinutesFromConfig } from '../../utils/adminConfig';

const LOCK_STORAGE_KEY = 'cad_session_locked';
const DEFAULT_TIMEOUT_MINUTES = 30;

export const SessionLockGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
  const [locked, setLocked] = useState(() => localStorage.getItem(LOCK_STORAGE_KEY) === 'true');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const idleTimerRef = useRef<number | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const lockSession = useCallback(() => {
    clearIdleTimer();
    localStorage.setItem(LOCK_STORAGE_KEY, 'true');
    setPassword('');
    setError('');
    setLocked(true);
  }, [clearIdleTimer]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const handleManualLock = () => lockSession();
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        lockSession();
      }
    };

    window.addEventListener('cad:lock-session', handleManualLock);
    document.addEventListener('keydown', handleShortcut, true);

    return () => {
      window.removeEventListener('cad:lock-session', handleManualLock);
      document.removeEventListener('keydown', handleShortcut, true);
    };
  }, [isAuthenticated, lockSession, user]);

  const scheduleLock = useCallback(() => {
    clearIdleTimer();
    if (!isAuthenticated || !user || locked || !Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
      return;
    }

    idleTimerRef.current = window.setTimeout(lockSession, timeoutMinutes * 60 * 1000);
  }, [clearIdleTimer, isAuthenticated, lockSession, locked, timeoutMinutes, user]);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated || !user) {
      clearIdleTimer();
      setLocked(false);
      setPassword('');
      setError('');
      return;
    }

    authClient
      .getActiveConfiguration()
      .then((items) => setTimeoutMinutes(sessionTimeoutMinutesFromConfig(items, DEFAULT_TIMEOUT_MINUTES)))
      .catch(() => setTimeoutMinutes(DEFAULT_TIMEOUT_MINUTES));
  }, [clearIdleTimer, isAuthenticated, isLoading, user]);

  useEffect(() => {
    if (!isAuthenticated || !user || locked) {
      clearIdleTimer();
      return;
    }

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, scheduleLock, { passive: true }));
    document.addEventListener('visibilitychange', scheduleLock);
    scheduleLock();

    return () => {
      clearIdleTimer();
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, scheduleLock));
      document.removeEventListener('visibilitychange', scheduleLock);
    };
  }, [clearIdleTimer, isAuthenticated, locked, scheduleLock, user]);

  useEffect(() => {
    if (!locked) return;
    const focusTimer = window.setTimeout(() => passwordInputRef.current?.focus(), 80);
    return () => window.clearTimeout(focusTimer);
  }, [locked]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim()) {
      setError('Enter your password to unlock.');
      return;
    }

    try {
      setUnlocking(true);
      setError('');
      await authClient.verifyPassword(password);
      localStorage.removeItem(LOCK_STORAGE_KEY);
      setPassword('');
      setLocked(false);
      scheduleLock();
    } catch {
      setError('Password did not match this session.');
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <>
      {children}
      {isAuthenticated && user && locked && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/95 p-4 text-white">
          <form
            onSubmit={unlock}
            className="floating-window-mac-enter login-card-border w-[min(92vw,26rem)] overflow-hidden rounded-lg border border-white/15 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="border-b border-cad-line bg-cad-navy px-5 py-4 text-white dark:border-slate-700">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/12">
                  <LockKeyhole size={20} />
                </span>
                <div>
                  <h1 className="text-base font-bold">{APP_NAME} Locked</h1>
                  <p className="text-xs text-blue-100">Session secured after inactivity</p>
                </div>
              </div>
            </div>

            <div className="p-5 text-cad-ink dark:text-slate-100">
              <div className="mb-4 flex items-center gap-3 rounded-md border border-cad-line bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cad-blue text-sm font-bold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{user.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
              </div>

              <label className="grid gap-1 text-sm font-semibold">
                Password
                <input
                  ref={passwordInputRef}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="rounded-md border border-cad-line bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-blue-950"
                  autoComplete="current-password"
                />
              </label>

              {error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {error}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-2 rounded-md border border-cad-line px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
                <button
                  type="submit"
                  disabled={unlocking}
                  className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {unlocking ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  Unlock
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
};
