import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db/mysql';
import { ChatMessage, MessageAttachment, MessageThread, SendMessageRequest } from '../types/auth';

type MessageRow = RowDataPacket & {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  body_iv: string | null;
  body_tag: string | null;
  encrypted: number | boolean;
  read_at: Date | null;
  created_at: Date;
  sender_reaction: string | null;
  recipient_reaction: string | null;
  sender_deleted_at: Date | null;
  recipient_deleted_at: Date | null;
};

type AttachmentRow = RowDataPacket & {
  id: string;
  message_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  data: Buffer;
  data_iv: string | null;
  data_tag: string | null;
  encrypted: number | boolean;
};

type EncryptedValue = {
  value: string;
  iv: string | null;
  tag: string | null;
  encrypted: boolean;
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const encryptionKey = (): Buffer => {
  const configured = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'cad-development-message-key';
  return crypto.createHash('sha256').update(configured).digest();
};

const encryptText = (plainText: string): EncryptedValue => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return {
    value: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    encrypted: true
  };
};

const decryptText = (value: string, iv: string | null, tag: string | null, encrypted: number | boolean): string => {
  if (!encrypted || !iv || !tag) {
    return value;
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    console.warn('Unable to decrypt message body. Check MESSAGE_ENCRYPTION_KEY for legacy messages.', error);
    return '[Encrypted message unavailable]';
  }
};

const encryptBuffer = (buffer: Buffer): { data: Buffer; iv: string; tag: string } => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  return {
    data: Buffer.concat([cipher.update(buffer), cipher.final()]),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
};

const decryptBuffer = (buffer: Buffer, iv: string | null, tag: string | null, encrypted: number | boolean): Buffer => {
  if (!encrypted || !iv || !tag) {
    return buffer;
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
};

const parseDataUrl = (dataUrl: string): Buffer => {
  const [, base64 = ''] = dataUrl.split(',');
  return Buffer.from(base64, 'base64');
};

const toAttachment = (row: AttachmentRow): MessageAttachment | null => {
  try {
    const data = decryptBuffer(row.data, row.data_iv, row.data_tag, row.encrypted);
    return {
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      size: row.size_bytes,
      dataUrl: `data:${row.mime_type};base64,${data.toString('base64')}`
    };
  } catch (error) {
    console.warn('Unable to decrypt message attachment. Check MESSAGE_ENCRYPTION_KEY for legacy attachments.', error);
    return null;
  }
};

const toMessage = (row: MessageRow, attachments: MessageAttachment[] = []): ChatMessage => ({
  id: row.id,
  senderId: row.sender_id,
  recipientId: row.recipient_id,
  body: decryptText(row.body, row.body_iv, row.body_tag, row.encrypted),
  encrypted: Boolean(row.encrypted),
  attachments,
  readAt: row.read_at || undefined,
  createdAt: row.created_at,
  senderReaction: row.sender_reaction || null,
  recipientReaction: row.recipient_reaction || null
});

export class MessageService {
  static async createMessage(
    senderId: string,
    recipientId: string,
    body: string,
    attachments: SendMessageRequest['attachments'] = []
  ): Promise<ChatMessage> {
    const id = uuidv4();
    const trimmedBody = body.trim();
    const encryptedBody = encryptText(trimmedBody);
    const safeAttachments = attachments.slice(0, MAX_ATTACHMENTS);

    await pool.execute(
      `
        INSERT INTO messages (id, sender_id, recipient_id, body, body_iv, body_tag, encrypted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [id, senderId, recipientId, encryptedBody.value, encryptedBody.iv, encryptedBody.tag, encryptedBody.encrypted]
    );

    for (const attachment of safeAttachments) {
      const fileBuffer = parseDataUrl(attachment.dataUrl);
      if (fileBuffer.length === 0 || fileBuffer.length > MAX_ATTACHMENT_BYTES) {
        continue;
      }

      const encryptedFile = encryptBuffer(fileBuffer);
      await pool.execute(
        `
          INSERT INTO message_attachments (
            id,
            message_id,
            file_name,
            mime_type,
            size_bytes,
            data,
            data_iv,
            data_tag,
            encrypted
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          uuidv4(),
          id,
          attachment.fileName.slice(0, 255),
          attachment.mimeType.slice(0, 120) || 'application/octet-stream',
          fileBuffer.length,
          encryptedFile.data,
          encryptedFile.iv,
          encryptedFile.tag,
          true
        ]
      );
    }

    const message = await this.getMessage(id);
    if (!message) {
      throw new Error('Message was not created.');
    }
    return message;
  }

  static async getMessage(id: string): Promise<ChatMessage | null> {
    const [rows] = await pool.execute<MessageRow[]>(
      'SELECT * FROM messages WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows[0]) {
      return null;
    }

    const attachments = await this.getAttachments([id]);
    return toMessage(rows[0], attachments[id] || []);
  }

  static async getConversation(userId: string, otherUserId: string): Promise<ChatMessage[]> {
    const [rows] = await pool.execute<MessageRow[]>(
      `
        SELECT *
        FROM messages
        WHERE (
            (sender_id = ? AND recipient_id = ?)
            OR (sender_id = ? AND recipient_id = ?)
          )
          AND NOT (
            (sender_id = ? AND sender_deleted_at IS NOT NULL)
            OR (recipient_id = ? AND recipient_deleted_at IS NOT NULL)
          )
        ORDER BY created_at ASC
        LIMIT 200
      `,
      [userId, otherUserId, otherUserId, userId, userId, userId]
    );
    const attachments = await this.getAttachments(rows.map((row) => row.id));
    return rows.map((row) => toMessage(row, attachments[row.id] || []));
  }

  static async searchConversation(userId: string, otherUserId: string, query: string): Promise<ChatMessage[]> {
    const normalized = query.trim().toLowerCase();
    const conversation = await this.getConversation(userId, otherUserId);
    if (!normalized) {
      return conversation;
    }

    return conversation.filter((message) => {
      const attachmentMatch = message.attachments.some((attachment) =>
        attachment.fileName.toLowerCase().includes(normalized)
      );
      return message.body.toLowerCase().includes(normalized) || attachmentMatch;
    });
  }

  static async getThreads(userId: string): Promise<MessageThread[]> {
    const [threadRows] = await pool.execute<(RowDataPacket & {
      other_user_id: string;
      last_message_id: string;
      updated_at: Date;
      unread_count: number;
    })[]>(
      `
        SELECT
          CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_user_id,
          SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY created_at DESC), ',', 1) AS last_message_id,
          MAX(created_at) AS updated_at,
          SUM(CASE WHEN recipient_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
        FROM messages
        WHERE (sender_id = ? OR recipient_id = ?)
          AND NOT (
            (sender_id = ? AND sender_deleted_at IS NOT NULL)
            OR (recipient_id = ? AND recipient_deleted_at IS NOT NULL)
          )
        GROUP BY other_user_id
        ORDER BY updated_at DESC
        LIMIT 200
      `,
      [userId, userId, userId, userId, userId, userId]
    );

    const messageIds = threadRows.map((row) => row.last_message_id).filter(Boolean);
    if (messageIds.length === 0) {
      return [];
    }

    const placeholders = messageIds.map(() => '?').join(',');
    const [messageRows] = await pool.execute<MessageRow[]>(
      `SELECT * FROM messages WHERE id IN (${placeholders})`,
      messageIds
    );
    const attachments = await this.getAttachments(messageIds);
    const messagesById = messageRows.reduce<Record<string, ChatMessage>>((messages, row) => {
      messages[row.id] = toMessage(row, attachments[row.id] || []);
      return messages;
    }, {});

    return threadRows.map((row) => ({
      userId: row.other_user_id,
      lastMessage: messagesById[row.last_message_id],
      unreadCount: Number(row.unread_count || 0),
      updatedAt: row.updated_at
    }));
  }

  static async markRead(userId: string, otherUserId: string): Promise<string[]> {
    const [rows] = await pool.execute<(RowDataPacket & { id: string })[]>(
      `
        SELECT id
        FROM messages
        WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
      `,
      [otherUserId, userId]
    );

    await pool.execute(
      `
        UPDATE messages
        SET read_at = UTC_TIMESTAMP()
        WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
      `,
      [otherUserId, userId]
    );

    return rows.map((row) => row.id);
  }

  static async react(messageId: string, userId: string, reaction: string | null): Promise<ChatMessage> {
    const message = await this.getMessage(messageId);
    if (!message || (message.senderId !== userId && message.recipientId !== userId)) {
      throw new Error('Message not found.');
    }

    const column = message.senderId === userId ? 'sender_reaction' : 'recipient_reaction';
    await pool.execute(
      `UPDATE messages SET ${column} = ? WHERE id = ?`,
      [reaction?.slice(0, 32) || null, messageId]
    );

    const updated = await this.getMessage(messageId);
    if (!updated) {
      throw new Error('Message not found.');
    }
    return updated;
  }

  static async deleteMessage(messageId: string, userId: string): Promise<ChatMessage | null> {
    const message = await this.getMessage(messageId);
    if (!message || (message.senderId !== userId && message.recipientId !== userId)) {
      return null;
    }

    const column = message.senderId === userId ? 'sender_deleted_at' : 'recipient_deleted_at';
    await pool.execute(
      `UPDATE messages SET ${column} = UTC_TIMESTAMP() WHERE id = ?`,
      [messageId]
    );
    return message;
  }

  static async deleteConversation(userId: string, otherUserId: string): Promise<string[]> {
    const conversation = await this.getConversation(userId, otherUserId);
    const messageIds = conversation.map((message) => message.id);
    if (messageIds.length === 0) {
      return [];
    }

    await pool.execute(
      `
        UPDATE messages
        SET
          sender_deleted_at = CASE WHEN sender_id = ? THEN UTC_TIMESTAMP() ELSE sender_deleted_at END,
          recipient_deleted_at = CASE WHEN recipient_id = ? THEN UTC_TIMESTAMP() ELSE recipient_deleted_at END
        WHERE (sender_id = ? AND recipient_id = ?)
           OR (sender_id = ? AND recipient_id = ?)
      `,
      [userId, userId, userId, otherUserId, otherUserId, userId]
    );

    return messageIds;
  }

  private static async getAttachments(messageIds: string[]): Promise<Record<string, MessageAttachment[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    const placeholders = messageIds.map(() => '?').join(',');
    const [rows] = await pool.execute<AttachmentRow[]>(
      `
        SELECT *
        FROM message_attachments
        WHERE message_id IN (${placeholders})
        ORDER BY created_at ASC
      `,
      messageIds
    );

    return rows.reduce<Record<string, MessageAttachment[]>>((groups, row) => {
      const attachment = toAttachment(row);
      if (!attachment) {
        return groups;
      }
      groups[row.message_id] = groups[row.message_id] || [];
      groups[row.message_id].push(attachment);
      return groups;
    }, {});
  }
}
