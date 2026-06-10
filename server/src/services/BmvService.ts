import { v4 as uuidv4 } from 'uuid';
import { BmvInquiryRequest, BmvInquiryResponse } from '../types/auth';

const bmvEndpoint = process.env.BMV_API_URL || '';
const bmvApiKey = process.env.BMV_API_KEY || '';
const requestTimeoutMs = Number(process.env.BMV_API_TIMEOUT_MS || 12000);

const validateInquiry = (input: BmvInquiryRequest): void => {
  if (!input.reason?.trim()) throw new Error('BMV inquiry reason is required');
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
  throw new Error('Unsupported BMV inquiry type');
};

export class BmvService {
  static async submitInquiry(input: BmvInquiryRequest, requestedBy: string): Promise<BmvInquiryResponse> {
    validateInquiry(input);

    if (!bmvEndpoint) {
      return {
        id: uuidv4(),
        status: 'not_configured',
        source: 'BMV',
        message: 'BMV integration is ready, but no approved BMV endpoint is configured.',
        requestedAt: new Date()
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(bmvEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bmvApiKey ? { Authorization: `Bearer ${bmvApiKey}` } : {})
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
          source: 'BMV',
          message: typeof record.error === 'string' ? record.error : 'BMV inquiry was rejected by the configured endpoint.',
          requestedAt: new Date(),
          record
        };
      }

      return {
        id: uuidv4(),
        status: 'submitted',
        source: 'BMV',
        message: 'BMV inquiry submitted to configured endpoint.',
        requestedAt: new Date(),
        record
      };
    } catch (error) {
      return {
        id: uuidv4(),
        status: 'error',
        source: 'BMV',
        message: error instanceof Error && error.name === 'AbortError' ? 'BMV inquiry timed out.' : 'Unable to reach configured BMV endpoint.',
        requestedAt: new Date()
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
