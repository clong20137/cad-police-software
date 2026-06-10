import React, { useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Search, ShieldAlert } from 'lucide-react';

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
  const sourceUrl = useMemo(() => buildCourtSearchUrl(mode, name, dob, caseNumber), [caseNumber, dob, mode, name]);
  const [embeddedUrl, setEmbeddedUrl] = useState(courtPortalUrl);
  const [frameKey, setFrameKey] = useState(0);
  const title = mode === 'mycase' ? 'MyCase' : 'Protective Orders';

  const loadInCad = (nextMode = mode) => {
    setEmbeddedUrl(buildCourtSearchUrl(nextMode, name, dob, caseNumber));
    setFrameKey((value) => value + 1);
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
              loadInCad(tabId);
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => loadInCad()}
          className="inline-flex items-center gap-2 rounded-md bg-cad-blue px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-800"
        >
          <Search size={16} />
          Search In CAD
        </button>
        <button
          type="button"
          onClick={() => setFrameKey((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-md border border-cad-line px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw size={15} />
          Reload
        </button>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-cad-line px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Open {title}
          <ExternalLink size={15} />
        </a>
      </div>

      <div className="overflow-hidden rounded-lg border border-cad-line bg-white shadow-inner dark:border-slate-700 dark:bg-slate-950">
        <div className="border-b border-cad-line bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{title}</p>
          <p className="truncate text-xs font-semibold text-slate-600 dark:text-slate-300">Source: {embeddedUrl}</p>
        </div>
        <iframe
          key={frameKey}
          src={embeddedUrl}
          title={`${title} court lookup`}
          className="h-[min(58vh,34rem)] w-full bg-white"
          sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
        />
      </div>

      <div className="rounded-md border border-cad-line bg-slate-50 p-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
        Data source: Indiana public courts portal at public.courts.in.gov and MyCase at public.courts.in.gov/mycase. If the court portal blocks embedded display, use Open {title}. A direct data pull can be added when Indiana provides an approved endpoint or integration credentials.
      </div>
    </div>
  );
};
