import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/connection.ts';
import { EmailSchema, NonEmptyStringSchema, type User, newUserId } from '../domain/user.ts';
import { createSqliteUserRepository } from './sqlite-user-repository.ts';

function buildUser(emailRaw: string, nameRaw: string): User {
  return {
    id: newUserId(),
    email: EmailSchema.parse(emailRaw),
    name: NonEmptyStringSchema.parse(nameRaw),
  };
}

function makeRepo() {
  const db = openDatabase(':memory:');
  return { repo: createSqliteUserRepository(db), db };
}

describe('SqliteUserRepository', () => {
  it('returns null when no user matches the email', async () => {
    const { repo } = makeRepo();
    const email = EmailSchema.parse('jose@example.com');
    assert.equal(await repo.findByEmail(email), null);
  });

  it('persists a user via save and retrieves it via findByEmail', async () => {
    const { repo } = makeRepo();
    const user = buildUser('jose@example.com', 'Jose');

    await repo.save(user);
    const found = await repo.findByEmail(user.email);

    assert.deepEqual(found, user);
  });

  it('returns a User with branded fields (parsed from the row)', async () => {
    const { repo } = makeRepo();
    const user = buildUser('jose@example.com', 'Jose');

    await repo.save(user);
    const found = await repo.findByEmail(user.email);

    assert.ok(found);
    // Branded types live at the type level, but the runtime check confirms
    // that the values came out of the schema parse pipeline.
    assert.equal(typeof found.id, 'string');
    assert.match(found.id, /^[0-9a-f-]{36}$/);
    assert.equal(found.email, user.email);
    assert.equal(found.name, user.name);
  });

  it('upserts when saving twice with the same email', async () => {
    const { repo } = makeRepo();
    const first = buildUser('jose@example.com', 'Jose');
    const second = { ...first, name: NonEmptyStringSchema.parse('Jose Updated') };

    await repo.save(first);
    await repo.save(second);
    const found = await repo.findByEmail(first.email);

    assert.equal(found?.name, 'Jose Updated');
  });

  it('isolates state between :memory: instances', async () => {
    const { repo: repoA } = makeRepo();
    const { repo: repoB } = makeRepo();
    const user = buildUser('jose@example.com', 'Jose');

    await repoA.save(user);

    assert.deepEqual(await repoA.findByEmail(user.email), user);
    assert.equal(await repoB.findByEmail(user.email), null);
  });

  it('persists data between calls on the same DB file', async () => {
    const path = `/tmp/test-${Date.now()}-${Math.random()}.db`;
    try {
      const dbA = openDatabase(path);
      const repoA = createSqliteUserRepository(dbA);
      const user = buildUser('jose@example.com', 'Jose');
      await repoA.save(user);
      dbA.close();

      const dbB = openDatabase(path);
      const repoB = createSqliteUserRepository(dbB);
      const found = await repoB.findByEmail(user.email);
      dbB.close();

      assert.deepEqual(found, user);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // best-effort cleanup
      }
    }
  });
});
