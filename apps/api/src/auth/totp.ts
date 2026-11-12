import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function createSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0; let value = 0; let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; }
  }
  return result;
}
function decode(secret: string): Buffer {
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of secret) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Secreto TOTP inválido');
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
export function codeAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', decode(secret)).update(message).digest();
  const offset = hash[hash.length - 1]! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export function verifyCode(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current - 1, current, current + 1]) {
    if (counter >= 0 && timingSafeEqual(Buffer.from(codeAt(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}
function key(): Buffer {
  const value = process.env.MFA_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('MFA_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales.');
  return Buffer.from(value, 'hex');
}
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('hex')).join(':');
}
export function decryptSecret(value: string): string {
  const [iv, tag, data] = value.split(':');
  if (!iv || !tag || !data) throw new Error('Secreto MFA inválido');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}
