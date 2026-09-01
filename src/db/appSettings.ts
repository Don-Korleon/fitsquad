import { dbGet, dbRun } from "./client.js";

const APPSS_VERIFY_SETTING_KEY = "appss_verify_code";

export async function getStoredAppssVerifyCode(): Promise<string | null> {
  const row = (await dbGet(`SELECT value FROM app_settings WHERE key = ?`, [
    APPSS_VERIFY_SETTING_KEY,
  ])) as { value: string } | undefined;
  const value = row?.value?.trim();
  return value || null;
}

export async function setStoredAppssVerifyCode(code: string): Promise<void> {
  await dbRun(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [APPSS_VERIFY_SETTING_KEY, code.trim()]
  );
}
