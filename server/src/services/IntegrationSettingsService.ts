import { ConfigurationService } from './ConfigurationService';

export type SensitiveIntegrationCode = 'BMV' | 'IDACS' | 'COURTS';

export interface SensitiveIntegrationSettings {
  code: SensitiveIntegrationCode;
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  requireReason: boolean;
  myCaseEndpoint?: string;
}

const numberFromMetadata = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const stringFromMetadata = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback;

const booleanFromMetadata = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export class IntegrationSettingsService {
  static async get(code: SensitiveIntegrationCode): Promise<SensitiveIntegrationSettings> {
    const item = await ConfigurationService.getBySectionCode('integrations', code);
    const metadata = item?.metadata || {};
    const envPrefix = code;
    return {
      code,
      enabled: item?.active !== false && booleanFromMetadata(metadata.enabled, code === 'COURTS'),
      endpoint: stringFromMetadata(metadata.endpoint, process.env[`${envPrefix}_API_URL`] || ''),
      apiKey: stringFromMetadata(metadata.apiKey, process.env[`${envPrefix}_API_KEY`] || ''),
      timeoutMs: numberFromMetadata(metadata.timeoutMs, Number(process.env[`${envPrefix}_API_TIMEOUT_MS`] || 12000)),
      requireReason: booleanFromMetadata(metadata.requireReason, true),
      myCaseEndpoint: stringFromMetadata(metadata.myCaseEndpoint, 'https://public.courts.in.gov/mycase/')
    };
  }
}
