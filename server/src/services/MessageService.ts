import { v4 as uuidv4 } from 'uuid';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db/mysql';
import { ChatMessage } from '../types/auth';

type MessageRow = RowDataPacket & {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: Date | null;
  created_at: Date;
};

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  senderId: row.sender_id,
  recipientId: row.recipient_id,
  body: row.body,
  readAt: row.read_at || undefined,
  createdAt: row.created_at
});

export class MessageService {
  static async createMessage(senderId: string, recipientId: string, body: string): Promise<ChatMessage> {
    const id = uuidv4();
    const trimmedBody = body.trim();

    await pool.execute(
      `
        INSERT INTO messages (id, sender_id, recipient_id, body)
        VALUES (?, ?, ?, ?)
      `,
      [id, senderId, recipientId, trimmedBody]
    );

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
    return rows[0] ? toMessage(rows[0]) : null;
  }

  static async getConversation(userId: string, otherUserId: string): Promise<ChatMessage[]> {
    const [rows] = await pool.execute<MessageRow[]>(
      `
        SELECT *
        FROM messages
        WHERE (sender_id = ? AND recipient_id = ?)
           OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at ASC
        LIMIT 200
      `,
      [userId, otherUserId, otherUserId, userId]
    );
    return rows.map(toMessage);
  }

  static async markRead(userId: string, otherUserId: string): Promise<void> {
    await pool.execute(
      `
        UPDATE messages
        SET read_at = UTC_TIMESTAMP()
        WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
      `,
      [otherUserId, userId]
    );
  }
}
