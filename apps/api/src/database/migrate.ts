import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const migrationLock = 842024003;

async function migrate() {
  const pool = new pg.Pool({ connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('SELECT pg_advisory_lock($1)', [migrationLock]);

    try {
      const applied = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
      const completed = new Set(applied.rows.map((migration) => migration.filename));
      const entries = await readdir(migrationsDirectory, { withFileTypes: true });
      const filenames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort();

      for (const filename of filenames) {
        if (completed.has(filename)) continue;

        const sql = await readFile(`${migrationsDirectory}/${filename}`, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
          await client.query('COMMIT');
          console.log(`Migración aplicada: ${filename}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
