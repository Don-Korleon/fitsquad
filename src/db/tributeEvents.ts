import { dbGet, dbRun } from "./client.js";

export async function isTributeEventProcessed(eventId: string): Promise<boolean> {
  const row = await dbGet(`SELECT 1 FROM tribute_events WHERE id = ?`, [eventId]);
  return !!row;
}

export async function markTributeEventProcessed(
  eventId: string,
  eventName: string,
  telegramUserId: number,
  payloadJson: string
): Promise<void> {
  await dbRun(
    `INSERT OR IGNORE INTO tribute_events (id, event_name, telegram_user_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [eventId, eventName, telegramUserId, payloadJson]
  );
}
