import { BmvInquiryRequest, CourtLookupAuditRequest, IdacsInquiryRequest, User, UserRole } from '../types/auth';
import { AuditLogService } from './AuditLogService';
import { AuthService } from './AuthService';
import { ConfigurationService } from './ConfigurationService';

type SensitiveInquiryRequest = BmvInquiryRequest | IdacsInquiryRequest;
type SensitiveLookupSource = 'BMV' | 'IDACS' | 'COURTS';

const normalizeDistrict = (value?: string | null): string => (value || '').trim().toLowerCase();

const assertMinimumReason = async (reason: string | undefined, source: SensitiveLookupSource): Promise<string> => {
  const minLength = Math.max(4, await ConfigurationService.getNumber('MIN_LOOKUP_REASON_LENGTH', 8));
  const normalized = reason?.trim() || '';
  if (normalized.length < minLength) {
    throw new Error(`${source} lookup reason must be at least ${minLength} characters`);
  }
  return normalized;
};

const assertDistrictAccess = async (requester: User, target: User | null): Promise<void> => {
  if (requester.role === UserRole.ADMIN) return;
  const districtScopeEnabled = await ConfigurationService.getBoolean('ENFORCE_DISTRICT_SCOPE', false);
  if (!districtScopeEnabled || !target) return;

  const requesterDistrict = normalizeDistrict(requester.district);
  const targetDistrict = normalizeDistrict(target.district);
  if (!requesterDistrict || !targetDistrict || requesterDistrict !== targetDistrict) {
    throw new Error('Lookup is outside your assigned district');
  }
};

export class AccessControlService {
  static async assertStrictRoleSideAccess(user: User, side: 'dispatch' | 'officer' | 'admin'): Promise<void> {
    const strict = await ConfigurationService.getBoolean('STRICT_ROLE_SIDE_ACCESS', true);
    if (!strict || user.role === UserRole.ADMIN) return;

    const allowed =
      side === 'dispatch'
        ? user.role === UserRole.DISPATCHER
        : side === 'officer'
          ? user.role === UserRole.OFFICER
          : false;

    if (!allowed) {
      throw new Error(`${side} access is not allowed for this account role`);
    }
  }

  static async authorizeSensitiveInquiry(
    input: SensitiveInquiryRequest,
    requester: User,
    source: Exclude<SensitiveLookupSource, 'COURTS'>
  ): Promise<SensitiveInquiryRequest> {
    const reason = await assertMinimumReason(input.reason, source);
    const targetOfficerId = input.officerId || requester.id;
    const targetOfficer = await AuthService.getUser(targetOfficerId);

    if (!targetOfficer || !targetOfficer.active) {
      throw new Error('Selected officer is not active');
    }

    if (![UserRole.OFFICER, UserRole.ADMIN].includes(targetOfficer.role)) {
      throw new Error('Sensitive lookups must be tied to an officer or admin account');
    }

    if (requester.role === UserRole.OFFICER && targetOfficer.id !== requester.id) {
      throw new Error('Officers can only run lookups under their own account');
    }

    if (![UserRole.ADMIN, UserRole.DISPATCHER, UserRole.OFFICER].includes(requester.role)) {
      throw new Error('Sensitive lookup access is not allowed for this account role');
    }

    await assertDistrictAccess(requester, targetOfficer);

    return {
      ...input,
      reason,
      officerId: targetOfficer.id
    };
  }

  static async authorizeCourtLookup(input: CourtLookupAuditRequest, requester: User): Promise<CourtLookupAuditRequest> {
    const reason = await assertMinimumReason(input.reason, 'COURTS');
    if (![UserRole.ADMIN, UserRole.DISPATCHER, UserRole.OFFICER].includes(requester.role)) {
      throw new Error('Court lookup access is not allowed for this account role');
    }

    return { ...input, reason };
  }

  static async auditDeniedLookup(userId: string | undefined, source: SensitiveLookupSource, reason: string): Promise<void> {
    await AuditLogService.record({
      userId,
      action: `${source.toLowerCase()}_lookup_denied`,
      resource: 'sensitive_inquiry',
      severity: 'warning',
      metadata: { reason }
    });
  }
}
