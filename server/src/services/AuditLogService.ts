import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import { AuditLogEntry, AuditSeverity } from '../types/auth';
import { AuditLogRow, pool } from '../db/mysql';

const toAuditLog = (row: AuditLogRow): AuditLogEntry => ({
  id: row.id,
  userId: row.user_id || undefined,
  action: row.action,
  resource: row.resource || undefined,
  resourceId: row.resource_id || undefined,
  severity: row.severity as AuditSeverity,
  ipAddress: row.ip_address || undefined,
  userAgent: row.user_agent || undefined,
  metadata:
    typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata as Record<string, unknown> | null) || undefined,
  createdAt: row.created_at
});

const boundedLimit = (value: number, fallback = 200): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 500);
};

export class AuditLogService {
  static async record(input: {
    userId?: string | null;
    action: string;
    resource?: string | null;
    resourceId?: string | null;
    severity?: AuditSeverity;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await pool.execute(
        `
          INSERT INTO audit_logs (
            id,
            user_id,
            action,
            resource,
            resource_id,
            severity,
            ip_address,
            user_agent,
            metadata
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          input.userId || null,
          input.action,
          input.resource || null,
          input.resourceId || null,
          input.severity || 'info',
          input.ipAddress || null,
          input.userAgent?.slice(0, 255) || null,
          input.metadata ? JSON.stringify(input.metadata) : null
        ]
      );
    } catch (error) {
      console.error('Audit log write failed:', error);
    }
  }

  static fromRequest(
    req: Request,
    input: {
      action: string;
      resource?: string | null;
      resourceId?: string | null;
      severity?: AuditSeverity;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    return this.record({
      ...input,
      userId: req.user?.id || null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null
    });
  }

  static async recent(limit = 200): Promise<AuditLogEntry[]> {
    const safeLimit = boundedLimit(limit);
    const [rows] = await pool.execute<AuditLogRow[]>(
      `
        SELECT *
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `
    );
    return rows.map(toAuditLog);
  }

  static async sensitiveInquiryHistory(limit = 200): Promise<AuditLogEntry[]> {
    const safeLimit = boundedLimit(limit);
    const [rows] = await pool.execute<AuditLogRow[]>(
      `
        SELECT *
        FROM audit_logs
        WHERE action IN ('bmv_inquiry', 'idacs_inquiry', 'court_lookup')
        ORDER BY created_at DESC
        LIMIT ${safeLimit}
      `
    );
    return rows.map(toAuditLog);
  }
}
