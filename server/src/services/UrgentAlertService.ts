import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/mysql';
import {
  CreateUrgentAlertRequest,
  UrgentAlert,
  UrgentAlertAudienceType,
  UrgentAlertSeverity,
  User
} from '../types/auth';
import { AuthService } from './AuthService';

const severityValues = new Set<UrgentAlertSeverity>(['Advisory', 'Important', 'Urgent', 'Critical']);
const audienceValues = new Set<UrgentAlertAudienceType>(['everyone', 'district', 'users']);

type UrgentAlertRow = RowDataPacket & {
  id: string;
  title: string;
  message: string;
  severity: UrgentAlertSeverity;
  audience_type: UrgentAlertAudienceType;
  audience_label: string | null;
  target_district: string | null;
  target_user_ids: string | null | string[];
  require_acknowledgement: number | boolean;
  expires_at: Date | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
  acknowledged_at?: Date | null;
  delivered_at?: Date | null;
  recipient_count?: number;
  acknowledged_count?: number;
};

const parseTargetUserIds = (value: string | string[] | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const toAlert = (row: UrgentAlertRow): UrgentAlert => ({
  id: row.id,
  title: row.title,
  message: row.message,
  severity: row.severity,
  audienceType: row.audience_type,
  audienceLabel: row.audience_label || undefined,
  targetDistrict: row.target_district || undefined,
  targetUserIds: parseTargetUserIds(row.target_user_ids),
  requireAcknowledgement: Boolean(row.require_acknowledgement),
  expiresAt: row.expires_at || undefined,
  createdBy: row.created_by || undefined,
  createdByName: row.created_by_name || undefined,
  createdAt: row.created_at,
  acknowledgedAt: row.acknowledged_at || undefined,
  deliveredAt: row.delivered_at || undefined,
  recipientCount: row.recipient_count === undefined ? undefined : Number(row.recipient_count || 0),
  acknowledgedCount: row.acknowledged_count === undefined ? undefined : Number(row.acknowledged_count || 0)
});

const activeUsers = async (): Promise<User[]> => (await AuthService.getUsers()).filter((user) => user.active);

export class UrgentAlertService {
  private static async recipients(input: CreateUrgentAlertRequest): Promise<User[]> {
    const users = await activeUsers();
    if (input.audienceType === 'users') {
      const targetIds = new Set((input.targetUserIds || []).filter(Boolean));
      return users.filter((user) => targetIds.has(user.id));
    }
    if (input.audienceType === 'district') {
      const district = (input.targetDistrict || '').trim().toLowerCase();
      return users.filter((user) => (user.district || '').trim().toLowerCase() === district);
    }
    return users;
  }

  static async create(input: CreateUrgentAlertRequest, createdBy: User): Promise<UrgentAlert & { recipientIds: string[] }> {
    const title = input.title?.trim();
    const message = input.message?.trim();
    if (!title || !message) throw new Error('Alert title and message are required');

    const severity = severityValues.has(input.severity || 'Urgent') ? input.severity || 'Urgent' : 'Urgent';
    const audienceType = audienceValues.has(input.audienceType || 'everyone') ? input.audienceType || 'everyone' : 'everyone';
    const recipients = await this.recipients({ ...input, audienceType });
    if (audienceType === 'district' && !input.targetDistrict?.trim()) throw new Error('Choose a district for this alert');
    if (audienceType === 'users' && recipients.length === 0) throw new Error('Choose at least one person for this alert');

    const id = uuidv4();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 30 * 60 * 1000);
    const targetUserIds = audienceType === 'users' ? recipients.map((user) => user.id) : [];
    const audienceLabel =
      audienceType === 'district'
        ? `${input.targetDistrict} (${recipients.length})`
        : audienceType === 'users'
          ? `${recipients.length} selected`
          : `Everyone (${recipients.length})`;

    await pool.execute<ResultSetHeader>(
      `
        INSERT INTO urgent_alerts (
          id, title, message, severity, audience_type, audience_label, target_district,
          target_user_ids, require_acknowledgement, expires_at, created_by, created_by_name
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        title,
        message,
        severity,
        audienceType,
        audienceLabel,
        audienceType === 'district' ? input.targetDistrict?.trim() || null : null,
        JSON.stringify(targetUserIds),
        input.requireAcknowledgement !== false,
        Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
        createdBy.id,
        createdBy.name
      ]
    );

    if (recipients.length > 0) {
      await pool.execute<ResultSetHeader>(
        `
          INSERT INTO urgent_alert_acknowledgements (alert_id, user_id)
          VALUES ${recipients.map(() => '(?, ?)').join(', ')}
        `,
        recipients.flatMap((recipient) => [id, recipient.id])
      );
    }

    const alert = await this.get(id);
    if (!alert) throw new Error('Alert was not created');
    return { ...alert, recipientIds: recipients.map((recipient) => recipient.id) };
  }

  static async createOfficerEmergency(officer: User, lat?: number | null, lon?: number | null): Promise<UrgentAlert & { recipientIds: string[] }> {
    const unit = officer.cadUnitNumber || officer.unitNumber || officer.badge || officer.name;
    const location = Number.isFinite(lat) && Number.isFinite(lon) ? `GPS ${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}` : 'GPS location unavailable';
    const alert = await this.create(
      {
        title: `Officer Emergency - ${unit}`,
        message: `${officer.name} activated an emergency alert. ${location}`,
        severity: 'Critical',
        audienceType: 'everyone',
        requireAcknowledgement: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      },
      officer
    );
    if (!alert.recipientIds.includes(officer.id)) {
      await pool.execute<ResultSetHeader>(
        'INSERT IGNORE INTO urgent_alert_acknowledgements (alert_id, user_id) VALUES (?, ?)',
        [alert.id, officer.id]
      );
      alert.recipientIds.push(officer.id);
    }
    return alert;
  }

  static async get(id: string): Promise<UrgentAlert | null> {
    const [rows] = await pool.execute<UrgentAlertRow[]>('SELECT * FROM urgent_alerts WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? toAlert(rows[0]) : null;
  }

  static async pendingForUser(userId: string): Promise<UrgentAlert[]> {
    const [rows] = await pool.execute<UrgentAlertRow[]>(
      `
        SELECT a.*, ack.acknowledged_at, ack.delivered_at
        FROM urgent_alert_acknowledgements ack
        INNER JOIN urgent_alerts a ON a.id = ack.alert_id
        WHERE ack.user_id = ?
          AND ack.acknowledged_at IS NULL
          AND (a.expires_at IS NULL OR a.expires_at > UTC_TIMESTAMP())
        ORDER BY FIELD(a.severity, 'Critical', 'Urgent', 'Important', 'Advisory'), a.created_at ASC
      `,
      [userId]
    );
    return rows.map(toAlert);
  }

  static async recent(limit = 50): Promise<UrgentAlert[]> {
    const [rows] = await pool.execute<UrgentAlertRow[]>(
      `
        SELECT a.*,
          COUNT(ack.user_id) AS recipient_count,
          SUM(CASE WHEN ack.acknowledged_at IS NULL THEN 0 ELSE 1 END) AS acknowledged_count
        FROM urgent_alerts a
        LEFT JOIN urgent_alert_acknowledgements ack ON ack.alert_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at DESC
        LIMIT ?
      `,
      [limit]
    );
    return rows.map(toAlert);
  }

  static async acknowledge(alertId: string, userId: string): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>(
      `
        UPDATE urgent_alert_acknowledgements
        SET acknowledged_at = COALESCE(acknowledged_at, UTC_TIMESTAMP())
        WHERE alert_id = ? AND user_id = ?
      `,
      [alertId, userId]
    );
    return result.affectedRows > 0;
  }

  static async remove(alertId: string): Promise<boolean> {
    const [result] = await pool.execute<ResultSetHeader>('DELETE FROM urgent_alerts WHERE id = ?', [alertId]);
    return result.affectedRows > 0;
  }
}
