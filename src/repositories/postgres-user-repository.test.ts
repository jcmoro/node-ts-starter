import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { migrate } from '../db/migrate.ts';
import { type PostgresClient, closePostgres, openPostgres } from '../db/postgres.ts';
import { EmailSchema, NonEmptyStringSchema, type User, newUserId } from '../domain/user.ts';
import { createPostgresUserRepository } from './postgres-user-repository.ts';

// biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires brackets
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

function buildUser(emailRaw: string, nameRaw: string): User {
  return {
    id: newUserId(),
    email: EmailSchema.parse(emailRaw),
    name: NonEmptyStringSchema.parse(nameRaw),
  };
}

// Skip the entire suite if no test DB is configured. This is the senior
// pattern for tests that need infrastructure: degrade silently in local dev,
// run in CI where the URL is wired up.
describe(
  'PostgresUserRepository',
  { skip: !TEST_DATABASE_URL ? 'TEST_DATABASE_URL not set' : false },
  () => {
    let sql: PostgresClient;

    before(async () => {
      // biome-ignore lint/style/noNonNullAssertion: guarded by describe skip
      sql = openPostgres(TEST_DATABASE_URL!);
      await migrate(sql);
    });

    after(async () => {
      // Clean slate for the next run.
      await sql`TRUNCATE TABLE users`;
      await closePostgres(sql);
    });

    it('returns null when no user matches the email', async () => {
      const repo = createPostgresUserRepository(sql);
      const email = EmailSchema.parse(`nobody-${Date.now()}@example.com`);
      assert.equal(await repo.findByEmail(email), null);
    });

    it('persists a user via save and retrieves it via findByEmail', async () => {
      const repo = createPostgresUserRepository(sql);
      const user = buildUser(`save-${Date.now()}@example.com`, 'Jose');

      await repo.save(user);
      const found = await repo.findByEmail(user.email);

      assert.deepEqual(found, user);
    });

    it('upserts when saving twice with the same email', async () => {
      const repo = createPostgresUserRepository(sql);
      const first = buildUser(`upsert-${Date.now()}@example.com`, 'Jose');
      const second = { ...first, name: NonEmptyStringSchema.parse('Jose Updated') };

      await repo.save(first);
      await repo.save(second);
      const found = await repo.findByEmail(first.email);

      assert.equal(found?.name, 'Jose Updated');
    });

    it('returns a User with branded fields (parsed from the row)', async () => {
      const repo = createPostgresUserRepository(sql);
      const user = buildUser(`brands-${Date.now()}@example.com`, 'Jose');

      await repo.save(user);
      const found = await repo.findByEmail(user.email);

      assert.ok(found);
      assert.match(found.id, /^[0-9a-f-]{36}$/);
      assert.equal(found.email, user.email);
      assert.equal(found.name, user.name);
    });
  },
);
