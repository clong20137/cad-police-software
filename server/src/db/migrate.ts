import 'dotenv/config';
import { getAppliedMigrations, initializeDatabase, pool } from './mysql';

const run = async (): Promise<void> => {
  await initializeDatabase();
  const migrations = await getAppliedMigrations();
  console.log(`Database migrations applied: ${migrations.length}`);
  migrations.forEach((migration) => {
    console.log(`${migration.version} ${migration.name} ${migration.appliedAt.toISOString()}`);
  });
};

run()
  .catch((error) => {
    console.error('Database migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
