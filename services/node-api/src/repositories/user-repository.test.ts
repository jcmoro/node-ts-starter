import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EmailSchema, NonEmptyStringSchema, type User, newUserId } from '../domain/user.ts';
import { createInMemoryUserRepository } from './user-repository.ts';

function buildUser(emailRaw: string, nameRaw: string): User {
  return {
    id: newUserId(),
    email: EmailSchema.parse(emailRaw),
    name: NonEmptyStringSchema.parse(nameRaw),
  };
}

describe('InMemoryUserRepository', () => {
  it('returns null when no user matches the email', async () => {
    const repo = createInMemoryUserRepository();
    const email = EmailSchema.parse('jose@example.com');
    assert.equal(await repo.findByEmail(email), null);
  });

  it('persists a user via save and retrieves it via findByEmail', async () => {
    const repo = createInMemoryUserRepository();
    const user = buildUser('jose@example.com', 'Jose');

    await repo.save(user);
    const found = await repo.findByEmail(user.email);

    assert.deepEqual(found, user);
  });

  it('overwrites the user when saving twice with the same email', async () => {
    const repo = createInMemoryUserRepository();
    const first = buildUser('jose@example.com', 'Jose');
    const second = { ...first, name: NonEmptyStringSchema.parse('Jose Updated') };

    await repo.save(first);
    await repo.save(second);
    const found = await repo.findByEmail(first.email);

    assert.equal(found?.name, 'Jose Updated');
  });

  it('isolates state between instances', async () => {
    const repoA = createInMemoryUserRepository();
    const repoB = createInMemoryUserRepository();
    const user = buildUser('jose@example.com', 'Jose');

    await repoA.save(user);

    assert.deepEqual(await repoA.findByEmail(user.email), user);
    assert.equal(await repoB.findByEmail(user.email), null);
  });
});
