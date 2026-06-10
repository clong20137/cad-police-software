import { v4 as uuidv4 } from 'uuid';
import { IdacsInquiryRequest, IdacsInquiryResponse } from '../types/auth';

const idacsEndpoint = process.env.IDACS_API_URL || '';
const idacsApiKey = process.env.IDACS_API_KEY || '';
const requestTimeoutMs = Number(process.env.IDACS_API_TIMEOUT_MS || 12000);

const validateInquiry = (input: IdacsInquiryRequest): void => {
  if (!input.reason?.trim()) throw new Error('IDACS inquiry reason is required');
  if (input.kind === 'driver-license') {
    if (!input.driver?.name?.trim()) throw new Error('Driver name is required');
    return;
  }
  if (input.kind === 'vehicle-registration') {
    if (!input.vehicle?.plate?.trim() && !input.vehicle?.vin?.trim()) {
      throw new Error('Plate or VIN is required');
    }
    return;
  }
  throw new Error('Unsupported IDACS inquiry type');
};

export class IdacsService {
  static async submitInquiry(input: IdacsInquiryRequest, requestedBy: string): Promise<IdacsInquiryResponse> {
    validateInquiry(input);

    if (!idacsEndpoint) {
      return {
        id: uuidv4(),
        status: 'not_configured',
        source: 'IDACS',
        message: 'IDACS integration is ready, but no approved IDACS endpoint is configured.',
        requestedAt: new Date()
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(idacsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idacsApiKey ? { Authorization: `Bearer ${idacsApiKey}` } : {})
        },
        body: JSON.stringify({
          ...input,
          requestedBy,
          requestedAt: new Date().toISOString()
        }),
        signal: controller.signal
      });

      const record = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return {
          id: uuidv4(),
          status: 'error',
          source: 'IDACS',
          message: typeof record.error === 'string' ? record.error : 'IDACS inquiry was rejected by the configured endpoint.',
          requestedAt: new Date(),
          record
        };
      }

      return {
        id: uuidv4(),
        status: 'submitted',
        source: 'IDACS',
        message: 'IDACS inquiry submitted to configured endpoint.',
        requestedAt: new Date(),
        record
      };
    } catch (error) {
      return {
        id: uuidv4(),
        status: 'error',
        source: 'IDACS',
        message: error instanceof Error && error.name === 'AbortError' ? 'IDACS inquiry timed out.' : 'Unable to reach configured IDACS endpoint.',
        requestedAt: new Date()
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
