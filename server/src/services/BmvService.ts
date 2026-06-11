import { v4 as uuidv4 } from 'uuid';
import { BmvInquiryRequest, BmvInquiryResponse } from '../types/auth';
import { AuditLogService } from './AuditLogService';
import { IntegrationSettingsService } from './IntegrationSettingsService';

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
    const settings = await IntegrationSettingsService.get('BMV');

    if (!settings.enabled || !settings.endpoint) {
      const response = {
        id: uuidv4(),
        status: 'not_configured',
        source: 'BMV',
        message: 'BMV integration is ready, but no approved BMV endpoint is configured.',
        requestedAt: new Date()
      } as BmvInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'bmv_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: response.id,
        severity: 'warning',
        metadata: { kind: input.kind, reason: input.reason, officerId: input.officerId, status: response.status }
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
          source: 'BMV',
          message: typeof record.error === 'string' ? record.error : 'BMV inquiry was rejected by the configured endpoint.',
          requestedAt: new Date(),
          record
        } as BmvInquiryResponse;
        await AuditLogService.record({
          userId: requestedBy,
          action: 'bmv_inquiry',
          resource: 'sensitive_inquiry',
          resourceId: inquiryResponse.id,
          severity: 'error',
          metadata: { kind: input.kind, reason: input.reason, officerId: input.officerId, status: inquiryResponse.status }
        });
        return inquiryResponse;
      }

      const inquiryResponse = {
        id: uuidv4(),
        status: 'submitted',
        source: 'BMV',
        message: 'BMV inquiry submitted to configured endpoint.',
        requestedAt: new Date(),
        record
      } as BmvInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'bmv_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: inquiryResponse.id,
        metadata: { kind: input.kind, reason: input.reason, officerId: input.officerId, status: inquiryResponse.status }
      });
      return inquiryResponse;
    } catch (error) {
      const inquiryResponse = {
        id: uuidv4(),
        status: 'error',
        source: 'BMV',
        message: error instanceof Error && error.name === 'AbortError' ? 'BMV inquiry timed out.' : 'Unable to reach configured BMV endpoint.',
        requestedAt: new Date()
      } as BmvInquiryResponse;
      await AuditLogService.record({
        userId: requestedBy,
        action: 'bmv_inquiry',
        resource: 'sensitive_inquiry',
        resourceId: inquiryResponse.id,
        severity: 'error',
        metadata: { kind: input.kind, reason: input.reason, officerId: input.officerId, status: inquiryResponse.status }
      });
      return inquiryResponse;
    } finally {
      clearTimeout(timeout);
    }
  }
}
