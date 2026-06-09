import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Moon,
  Radio,
  Shield,
  Sun,
  User
} from 'lucide-react';
import { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { APP_DESCRIPTION, APP_NAME } from '../constants/branding';

const inputBase =
  'h-11 w-full rounded-md border border-cad-line bg-white px-3 text-sm text-cad-ink shadow-control outline-none transition placeholder:text-slate-400 focus:border-cad-blue focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500 dark:focus:ring-blue-950 dark:disabled:bg-slate-900';

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
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const isRegistering = mode === 'register';

  useEffect(() => {
    localStorage.setItem('cad_theme', theme);
  }, [theme]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const success = isRegistering
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

      if (success) {
        navigate('/');
      } else {
        setError(isRegistering ? 'Registration failed. Check the account details and password requirements.' : 'Invalid credentials.');
      }
    } catch {
      setError('Request failed. Please try again.');
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
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(26,54,93,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(26,54,93,0.05)_1px,transparent_1px)] bg-[size:56px_56px] dark:bg-[linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.07)_1px,transparent_1px)]" />

      <button
        type="button"
        onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        className="fixed right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-md border border-cad-line bg-white/95 text-cad-blue shadow-control hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/95 dark:text-blue-100 dark:hover:bg-slate-800"
        aria-label="Toggle light dark mode"
      >
        {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
      </button>

      <section className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-12">
        <section className={`mx-auto w-full rounded-lg border border-cad-line bg-white/95 shadow-shield dark:border-slate-800 dark:bg-slate-900/95 ${isRegistering ? 'max-w-xl' : 'max-w-sm'}`}>
          <div className="border-b border-cad-line p-5 text-center dark:border-slate-800 sm:p-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-cad-blue text-white shadow-control">
              <Shield size={24} />
            </div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.22em] text-cad-accent">Secure CAD</p>
            <h1 className="mt-1 text-2xl font-black text-cad-blue dark:text-blue-100">{APP_NAME}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{APP_DESCRIPTION}</p>
            <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-cad-accent" />

            <div className="mt-6">
              <h2 className="text-xl font-black text-slate-900 dark:text-white">
                {isRegistering ? 'Create agency account' : 'Welcome back'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {isRegistering ? 'Request access with your unit details.' : 'Sign in to continue.'}
              </p>
            </div>

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
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-cad-alert dark:border-red-900 dark:bg-red-950/50 dark:text-red-200" role="alert">
                {error}
              </div>
            )}

            {isRegistering && (
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
                  minLength={isRegistering ? 12 : undefined}
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
              {isRegistering && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Minimum 12 characters with agency password policy.</span>}
            </label>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-cad-blue px-4 text-sm font-black text-white shadow-control transition hover:bg-cad-secondary focus:outline-none focus:ring-4 focus:ring-cad-accent/30 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
              {loading ? 'Working...' : isRegistering ? 'Create Account' : 'Enter CAD'}
            </button>
          </form>
        </section>
      </section>
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
