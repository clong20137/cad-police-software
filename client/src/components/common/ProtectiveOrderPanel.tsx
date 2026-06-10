import React, { useMemo, useState } from 'react';
import { ExternalLink, Search, ShieldAlert } from 'lucide-react';
import { authClient } from '../../services/authClient';

const courtPortalUrl = 'https://public.courts.in.gov/';
const myCaseUrl = 'https://public.courts.in.gov/mycase/';
type CourtLookupMode = 'protective-orders' | 'mycase';

const buildCourtSearchUrl = (mode: CourtLookupMode, name: string, dob: string, caseNumber: string): string => {
  const baseUrl = mode === 'mycase' ? myCaseUrl : courtPortalUrl;
  const params = new URLSearchParams();
  if (name.trim()) params.set('q', name.trim());
  if (dob.trim()) params.set('dob', dob.trim());
  if (caseNumber.trim()) params.set('case', caseNumber.trim());
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
};

export const ProtectiveOrderPanel: React.FC = () => {
  const [mode, setMode] = useState<CourtLookupMode>('protective-orders');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [reason, setReason] = useState('Protective order / court record check');
  const [message, setMessage] = useState('');
  const sourceUrl = useMemo(() => buildCourtSearchUrl(mode, name, dob, caseNumber), [caseNumber, dob, mode, name]);
  const title = mode === 'mycase' ? 'MyCase' : 'Protective Orders';

  const auditLookup = async (nextMode = mode, nextUrl = sourceUrl) => {
    await authClient.auditCourtLookup({
      mode: nextMode,
      reason: reason.trim(),
      name: name.trim() || undefined,
      dob: dob || undefined,
      caseNumber: caseNumber.trim() || undefined,
      sourceUrl: nextUrl
    });
  };

  const launchPortal = (nextMode = mode) => {
    const nextUrl = buildCourtSearchUrl(nextMode, name, dob, caseNumber);
    if (!reason.trim()) {
      setMessage('Court lookup reason is required.');
      return;
    }
    window.open(nextUrl, '_blank', 'noopener,noreferrer');
    setMessage(`${nextMode === 'mycase' ? 'MyCase' : 'Protective Orders'} opened in a new tab. Court lookup audit pending.`);
    auditLookup(nextMode, nextUrl)
      .then(() => setMessage(`${nextMode === 'mycase' ? 'MyCase' : 'Protective Orders'} opened and court lookup was audited.`))
      .catch(() => setMessage('Court lookup opened, but audit logging failed.'));
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
        <div className="flex items-start gap-2">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <p>
            Court lookups use Indiana public court records. Confirm any hit through the court source and agency policy before taking action.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-cad-line dark:border-slate-700">
        {([
          ['protective-orders', 'Protective Orders'],
          ['mycase', 'MyCase']
        ] as Array<[CourtLookupMode, string]>).map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => {
              setMode(tabId);
            }}
            className={`h-10 text-sm font-black transition ${
              mode === tabId
                ? 'bg-cad-blue text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="First Last"
            className="h-10 rounded border border-cad-line bg-white px-3 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
          DOB
          <input
            type="date"
            value={dob}
            onChange={(event) => setDob(event.target.value)}
            className="h-10 rounded border border-cad-line bg-white px-3 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300">
          Case Number
          <input
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            placeholder="Optional"
            className="h-10 rounded border border-cad-line bg-white px-3 text-sm font-normal uppercase outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <label className="grid gap-1 text-sm font-bold text-slate-700 dark:text-slate-300 sm:col-span-3">
          Query Reason
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason required"
            className="h-10 rounded border border-cad-line bg-white px-3 text-sm font-normal outline-none focus:border-cad-blue focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => launchPortal()}
          disabled={!reason.trim()}
          className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"
        >
          <Search size={16} />
          Open {title}
          <ExternalLink size={15} />
        </button>
      </div>
      {message && <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</p>}

      <div className="grid gap-3 rounded-lg border border-cad-line bg-white p-4 shadow-inner dark:border-slate-700 dark:bg-slate-950">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Official Source</p>
          <p className="mt-1 break-all text-sm font-semibold text-slate-700 dark:text-slate-200">{sourceUrl}</p>
        </div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Indiana court portals block embedded display in CAD. Use Open {title} to launch the official source directly while CAD records the lookup audit.
        </p>
      </div>

      <div className="rounded-md border border-cad-line bg-slate-50 p-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
        Data source: Indiana public courts portal at public.courts.in.gov and MyCase at public.courts.in.gov/mycase. A direct data pull can be added when Indiana provides an approved endpoint or integration credentials.
      </div>
    </div>
  );
};
