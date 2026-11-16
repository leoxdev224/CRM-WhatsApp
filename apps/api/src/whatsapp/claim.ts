import type { Pool } from 'pg';

export type ClaimResult = 'connected' | 'duplicate' | 'duplicate_cleanup_failed';

export async function claimAccount(pool: Pool, channelId: string, jid: string, phone: string | null, unlink: () => Promise<void>): Promise<ClaimResult> {
  if (!jid) throw new Error('WhatsApp no devolvió un identificador de cuenta.');
  try {
    await pool.query("UPDATE channel_accounts SET phone_number=$2, provider_account_id=$3, connection_status='connected', connected_at=now() WHERE id=$1", [channelId, phone, jid]);
    return 'connected';
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code !== '23505' || !['channel_accounts_organization_phone_number_unique', 'channel_accounts_organization_provider_external_unique'].includes(pgError.constraint ?? '')) throw error;
    try {
      await unlink();
      await pool.query('DELETE FROM whatsapp_auth_state WHERE channel_account_id=$1', [channelId]);
      await pool.query("UPDATE channel_accounts SET connection_status='disconnected' WHERE id=$1", [channelId]);
      return 'duplicate';
    } catch {
      return 'duplicate_cleanup_failed';
    }
  }
}
