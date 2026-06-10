export type IndianaDistrict = {
  number: string;
  name: string;
  label: string;
  code: string;
};

export const indianaDistricts: IndianaDistrict[] = [
  { number: '13', name: 'Lowell', label: 'District 13 - Lowell', code: 'ISP-13' },
  { number: '14', name: 'Lafayette', label: 'District 14 - Lafayette', code: 'ISP-14' },
  { number: '16', name: 'Peru', label: 'District 16 - Peru', code: 'ISP-16' },
  { number: '21', name: 'Toll Road', label: 'District 21 - Toll Road', code: 'ISP-21' },
  { number: '22', name: 'Fort Wayne', label: 'District 22 - Fort Wayne', code: 'ISP-22' },
  { number: '24', name: 'Bremen', label: 'District 24 - Bremen', code: 'ISP-24' },
  { number: '33', name: 'Bloomington', label: 'District 33 - Bloomington', code: 'ISP-33' },
  { number: '34', name: 'Jasper', label: 'District 34 - Jasper', code: 'ISP-34' },
  { number: '35', name: 'Evansville', label: 'District 35 - Evansville', code: 'ISP-35' },
  { number: '42', name: 'Versailles', label: 'District 42 - Versailles', code: 'ISP-42' },
  { number: '45', name: 'Sellersburg', label: 'District 45 - Sellersburg', code: 'ISP-45' },
  { number: '51', name: 'Pendleton', label: 'District 51 - Pendleton', code: 'ISP-51' },
  { number: '52', name: 'Indianapolis', label: 'District 52 - Indianapolis', code: 'ISP-52' },
  { number: '53', name: 'Putnamville', label: 'District 53 - Putnamville', code: 'ISP-53' },
  { number: '76', name: 'Capitol Police', label: 'District 76 - Capitol Police', code: 'ISP-76' }
];

export const normalizeDistrictKey = (value?: string | null): string => {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return '';
  const numberMatch = normalized.match(/\b(?:district|isp)?[-\s]*(13|14|16|21|22|24|33|34|35|42|45|51|52|53|76)\b/);
  if (numberMatch) return numberMatch[1];
  const byName = indianaDistricts.find((district) => normalized.includes(district.name.toLowerCase()));
  return byName?.number || normalized;
};

export const districtLabelFor = (value?: string | null): string => {
  const key = normalizeDistrictKey(value);
  return indianaDistricts.find((district) => district.number === key)?.label || value || 'Unassigned';
};
