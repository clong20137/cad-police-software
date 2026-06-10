import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  AlertCircle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Moon,
  KeyRound,
  Radio,
  Shield,
  Sun,
  User,
  X
} from 'lucide-react';
import { TwoFactorChallengeResponse, UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { authClient } from '../services/authClient';
import { APP_NAME } from '../constants/branding';

const inputBase =
  'h-11 w-full rounded-md border border-cad-line bg-white px-3 text-sm text-cad-ink shadow-control outline-none transition placeholder:text-slate-400 focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:ring-blue-950 dark:disabled:bg-slate-900';

type ToastNotice = {
  id: string;
  title: string;
  message: string;
  tone: 'success' | 'error';
};

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('cad_theme') === 'dark' ? 'dark' : 'light'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [cadUnitNumber, setCadUnitNumber] = useState('');
  const [group, setGroup] = useState('');
  const [district, setDistrict] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.VIEWER);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<TwoFactorChallengeResponse | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const { login, register, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();

  const isRegistering = mode === 'register';
  const showCredentialFields = !twoFactorChallenge && backupCodes.length === 0;

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  const addToast = useCallback((title: string, message: string, tone: ToastNotice['tone'] = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [{ id, title, message, tone }, ...current].slice(0, 3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  useEffect(() => {
    let mounted = true;
    authClient
      .getPublicAuthSettings()
      .then((settings) => {
        if (!mounted) return;
        setRegistrationEnabled(settings.registrationEnabled);
        if (!settings.registrationEnabled) {
          setMode('login');
        }
      })
      .catch(() => {
        if (mounted) {
          setRegistrationEnabled(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (isRegistering && !registrationEnabled) {
      addToast('Registration disabled', 'An administrator has disabled public account requests.', 'error');
      setMode('login');
      return;
    }

    setLoading(true);

    try {
      if (backupCodes.length > 0) {
        setTransitioning(true);
        window.setTimeout(() => navigate('/'), 620);
        return;
      }

      if (twoFactorChallenge) {
        const result = await verifyTwoFactor(twoFactorChallenge.challengeToken, twoFactorCode);
        if (result.ok) {
          if (result.backupCodes?.length) {
            setBackupCodes(result.backupCodes);
            addToast('2FA enabled', 'Save your backup codes before continuing.', 'success');
            return;
          }
          setTransitioning(true);
          addToast('Signed in', 'Opening your dashboard.', 'success');
          window.setTimeout(() => navigate('/'), 620);
          return;
        }

        const message = 'Invalid two-factor code.';
        setError(message);
        addToast('Verification failed', message, 'error');
        return;
      }

      const result = isRegistering
        ? await register({
            email,
            password,
            name,
            role,
            badge,
            unitNumber,
            cadUnitNumber,
            status: 'Available',
            group,
            district
          })
        : await login(email, password);

      if (result.ok) {
        setTransitioning(true);
        addToast(isRegistering ? 'Account created' : 'Signed in', isRegistering ? 'Taking you into Blueline CAD.' : 'Opening your dashboard.', 'success');
        window.setTimeout(() => navigate('/'), 620);
      } else if (result.challenge) {
        setTwoFactorChallenge(result.challenge);
        setTwoFactorCode('');
        addToast(
          result.challenge.setupRequired ? 'Two-factor required' : 'Two-factor code required',
          result.challenge.setupRequired ? 'Add Blueline CAD to your authenticator app.' : 'Enter your authenticator code to continue.',
          'success'
        );
      } else {
        const message = isRegistering ? 'Registration failed. Check the account details and password requirements.' : 'Invalid credentials.';
        setError(message);
        addToast(isRegistering ? 'Registration failed' : 'Sign in failed', message, 'error');
      }
    } catch {
      const message = 'Request failed. Please try again.';
      setError(message);
      addToast('Request failed', message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className={`relative min-h-screen overflow-hidden ${
        theme === 'dark'
          ? 'dark bg-slate-950 text-slate-100'
          : 'bg-[linear-gradient(180deg,#f8fafc_0%,#edf2f7_100%)] text-cad-ink'
      }`}
    >
      <div className="login-grid-motion absolute inset-0 bg-[linear-gradient(90deg,rgba(26,54,93,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(26,54,93,0.05)_1px,transparent_1px)] bg-[size:56px_56px] dark:bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.07)_1px,transparent_1px)]" />
      <div className="login-scan-motion absolute left-0 top-0 h-full w-full opacity-70" />
      <div className="login-orbit-motion absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div className="login-sweep-motion absolute inset-x-0 top-1/4 h-px" />

      <button
        type="button"
        onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        className="fixed right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-md border border-cad-line bg-white/95 text-cad-blue shadow-control hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-100 dark:hover:bg-slate-800"
        aria-label="Toggle light dark mode"
      >
        {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
      </button>

      <section className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-12">
        <section className={`login-card-border mx-auto w-full rounded-lg bg-white/95 p-px shadow-shield transition-all duration-300 dark:bg-slate-900/95 ${isRegistering ? 'max-w-xl' : 'max-w-sm'} ${transitioning ? 'translate-y-1 scale-[0.985] opacity-75' : ''}`}>
          <div className="overflow-hidden rounded-[7px] bg-white/95 dark:bg-slate-900/95">
          <div className="border-b border-cad-line p-5 text-center dark:border-slate-800 sm:p-6">
            <div className="login-logo-pulse mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-cad-blue text-white shadow-control">
              <Radio size={25} />
            </div>
            <h1 className="mt-4 text-2xl font-black text-cad-blue dark:text-blue-100">{APP_NAME}</h1>
            <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-cad-accent" />

            {registrationEnabled && (
              <div className="mt-5 grid grid-cols-2 rounded-md border border-cad-line bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`rounded px-3 py-2 text-sm font-black transition ${
                    !isRegistering
                      ? 'bg-white text-cad-blue shadow-control dark:bg-slate-800 dark:text-blue-100'
                      : 'text-slate-600 hover:text-cad-blue dark:text-slate-300'
                  }`}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`rounded px-3 py-2 text-sm font-black transition ${
                    isRegistering
                      ? 'bg-white text-cad-blue shadow-control dark:bg-slate-800 dark:text-blue-100'
                      : 'text-slate-600 hover:text-cad-blue dark:text-slate-300'
                  }`}
                >
                  Register
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-cad-alert dark:border-red-900 dark:bg-red-950/50 dark:text-red-200" role="alert">
                {error}
              </div>
            )}

            {isRegistering && showCredentialFields && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="name" label="Full name" value={name} onChange={setName} icon={<User size={16} />} autoComplete="name" required disabled={loading} className="sm:col-span-2" />
                <label className="grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300">
                  Role
                  <div className="relative">
                    <Radio className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value as UserRole)}
                      disabled={loading}
                      className={`${inputBase} appearance-none pl-9 pr-8`}
                    >
                      <option value={UserRole.VIEWER}>Viewer</option>
                      <option value={UserRole.OFFICER}>Officer</option>
                      <option value={UserRole.DISPATCHER}>Dispatcher</option>
                    </select>
                  </div>
                </label>
                <TextField id="badge" label="Badge" value={badge} onChange={setBadge} icon={<BadgeCheck size={16} />} disabled={loading} />
                <TextField id="unitNumber" label="Unit" value={unitNumber} onChange={setUnitNumber} icon={<Radio size={16} />} disabled={loading} />
                <TextField id="cadUnitNumber" label="CAD Unit" value={cadUnitNumber} onChange={setCadUnitNumber} icon={<Shield size={16} />} disabled={loading} />
                <TextField id="group" label="Group" value={group} onChange={setGroup} icon={<Building2 size={16} />} disabled={loading} />
                <TextField id="district" label="District" value={district} onChange={setDistrict} icon={<Building2 size={16} />} disabled={loading} />
              </div>
            )}

            {showCredentialFields && (
              <>
                <TextField
                  id="email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  icon={<Mail size={16} />}
                  placeholder="name@agency.gov"
                  autoComplete="username"
                  required
                  disabled={loading}
                />

                <label className="grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300" htmlFor="password">
                  Password
                  <div className="relative">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Enter password"
                      autoComplete={isRegistering ? 'new-password' : 'current-password'}
                      required
                      minLength={isRegistering ? 14 : undefined}
                      disabled={loading}
                      className={`${inputBase} pl-9 pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-cad-blue dark:hover:bg-slate-800 dark:hover:text-blue-100"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {isRegistering && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Minimum 14 characters with uppercase, lowercase, number, and symbol.</span>}
                </label>
              </>
            )}

            {twoFactorChallenge && (
              <section className="rounded-md border border-cad-line bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cad-blue text-white">
                    <KeyRound size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-cad-blue dark:text-blue-100">
                      {twoFactorChallenge.setupRequired ? 'Set up 2FA' : 'Verify 2FA'}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
                      {twoFactorChallenge.setupRequired
                        ? 'Scan or manually enter this secret in your authenticator app, then enter the 6 digit code.'
                        : 'Enter the 6 digit code from your authenticator app.'}
                    </p>
                    {twoFactorChallenge.setupRequired && twoFactorChallenge.setup && (
                      <div className="mt-3 grid gap-2">
                        <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Manual secret
                          <input className={`${inputBase} h-10 font-mono text-xs`} readOnly value={twoFactorChallenge.setup.secret} />
                        </label>
                        <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Authenticator URL
                          <input className={`${inputBase} h-10 font-mono text-xs`} readOnly value={twoFactorChallenge.setup.otpauthUrl} />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
                <label className="mt-3 grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300" htmlFor="twoFactorCode">
                  2FA code
                  <input
                    id="twoFactorCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value)}
                    placeholder="123456"
                    required
                    disabled={loading}
                    className={inputBase}
                  />
                </label>
              </section>
            )}

            {backupCodes.length > 0 && (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="text-sm font-black">Backup codes</p>
                <p className="mt-1 text-xs font-semibold">These are shown once. Store them in a secure agency-approved location.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs font-black">
                  {backupCodes.map((code) => (
                    <span key={code} className="rounded border border-amber-200 bg-white px-2 py-1 dark:border-amber-800 dark:bg-slate-950">
                      {code}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <button
              type="submit"
              disabled={loading || transitioning}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cad-blue px-4 text-sm font-black text-white shadow-control transition hover:bg-cad-secondary focus:outline-none focus:ring-4 focus:ring-cad-accent/30 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <span>{loading || transitioning ? 'Opening...' : backupCodes.length > 0 ? 'Continue' : twoFactorChallenge ? 'Verify 2FA' : isRegistering ? 'Create Account' : 'Login'}</span>
              {loading || transitioning ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
            </button>
          </form>
          </div>
        </section>
      </section>

      <div className="fixed right-4 top-20 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} className={`login-toast-enter flex items-start gap-3 rounded-lg border bg-white/95 p-3 shadow-xl backdrop-blur-sm dark:bg-slate-900/95 ${toast.tone === 'success' ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}`}>
            {toast.tone === 'success' ? <CheckCircle2 size={18} className="mt-0.5 text-emerald-600" /> : <AlertCircle size={18} className="mt-0.5 text-red-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{toast.title}</p>
              <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">{toast.message}</p>
            </div>
            <button type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Dismiss notification">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </main>
  );
};

const TextField: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: React.ReactNode;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}> = ({ id, label, value, onChange, icon, type = 'text', placeholder, autoComplete, required, disabled, className = '' }) => (
  <label className={`grid gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 ${className}`} htmlFor={id}>
    {label}
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        className={`${inputBase} pl-9`}
      />
    </div>
  </label>
);
