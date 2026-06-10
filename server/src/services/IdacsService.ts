import { v4 as uuidv4 } from 'uuid';
import { IdacsInquiryRequest, IdacsInquiryResponse } from '../types/auth';
import { AuditLogService } from './AuditLogService';
import { IntegrationSettingsService } from './IntegrationSettingsService';

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
    const settings = await IntegrationSettingsService.get('IDACS');

    if (!settings.enabled || !settings.endpoint) {
      const response = {
        id: uuidv4(),
        status: 'not_configured',
        source: 'IDACS',
        message: 'IDACS integration is ready, but no approved IDACS endpoint is configured.',
        requestedAt: new Date()
      } as IdacsInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'idacs_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: response.id,
        severity: 'warning',
        metadata: { kind: input.kind, reason: input.reason, status: response.status }
      });
      return response;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await fetch(settings.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
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
        const inquiryResponse = {
          id: uuidv4(),
          status: 'error',
          source: 'IDACS',
          message: typeof record.error === 'string' ? record.error : 'IDACS inquiry was rejected by the configured endpoint.',
          requestedAt: new Date(),
          record
        } as IdacsInquiryResponse;
        await AuditLogService.record({
          userId: requestedBy,
          action: 'idacs_inquiry',
          resource: 'sensitive_inquiry',
          resourceId: inquiryResponse.id,
          severity: 'error',
          metadata: { kind: input.kind, reason: input.reason, status: inquiryResponse.status }
        });
        return inquiryResponse;
      }

      const inquiryResponse = {
        id: uuidv4(),
        status: 'submitted',
        source: 'IDACS',
        message: 'IDACS inquiry submitted to configured endpoint.',
        requestedAt: new Date(),
        record
      } as IdacsInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'idacs_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: inquiryResponse.id,
        metadata: { kind: input.kind, reason: input.reason, status: inquiryResponse.status }
      });
      return inquiryResponse;
    } catch (error) {
      const inquiryResponse = {
        id: uuidv4(),
        status: 'error',
        source: 'IDACS',
        message: error instanceof Error && error.name === 'AbortError' ? 'IDACS inquiry timed out.' : 'Unable to reach configured IDACS endpoint.',
        requestedAt: new Date()
      } as IdacsInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'idacs_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: inquiryResponse.id,
        severity: 'error',
        metadata: { kind: input.kind, reason: input.reason, status: inquiryResponse.status }
      });
      return inquiryResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
