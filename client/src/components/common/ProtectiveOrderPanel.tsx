import React, { useMemo, useState } from 'react';
import { ExternalLink, Search, ShieldAlert } from 'lucide-react';

const courtPortalUrl = 'https://public.courts.in.gov/';

const buildCourtSearchUrl = (name: string, dob: string): string => {
  const params = new URLSearchParams();
  if (name.trim()) params.set('name', name.trim());
  if (dob.trim()) params.set('dob', dob.trim());
  const query = params.toString();
  return query ? `${courtPortalUrl}?${query}` : courtPortalUrl;
};

export const ProtectiveOrderPanel: React.FC = () => {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const sourceUrl = useMemo(() => buildCourtSearchUrl(name || caseNumber, dob), [caseNumber, dob, name]);

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
        <div className="flex items-start gap-2">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <p>
            Protective order checks use Indiana public court records. Confirm any hit through the court source and agency policy before taking action.
          </p>
        </div>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-800"
        >
          <Search size={16} />
          Search Public Courts
          <ExternalLink size={15} />
        </a>
        <a
          href={courtPortalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-cad-line px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Open Portal
          <ExternalLink size={15} />
        </a>
      </div>

      <div className="rounded-md border border-cad-line bg-slate-50 p-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
        Data source: Indiana public courts portal at public.courts.in.gov. This panel launches the court source for live lookup; a direct data pull can be added when Indiana provides an approved endpoint or integration credentials.
      </div>
    </div>
  );
};
