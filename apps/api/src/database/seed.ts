import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const seedFile = fileURLToPath(new URL('../../db/seeds/001_development.sql', import.meta.url));

async function seed() {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const client = await pool.connect();

  try {
    const sql = await readFile(seedFile, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log('Datos ficticios cargados.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void seed().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
