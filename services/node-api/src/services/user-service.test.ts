import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateUserSchema } from '../domain/user.ts';
import { createInMemoryUserRepository } from '../repositories/user-repository.ts';
import { createUser } from './user-service.ts';

const payload = CreateUserSchema.parse({
  email: 'jose@example.com',
  name: 'Jose',
});

describe('createUser', () => {
  it('creates a new user and persists it', async () => {
    const repo = createInMemoryUserRepository();

    const result = await createUser(repo, payload);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.email, payload.email);
      assert.equal(result.value.name, payload.name);
      assert.match(result.value.id, /^[0-9a-f-]{36}$/);

      const persisted = await repo.findByEmail(payload.email);
      assert.deepEqual(persisted, result.value);
    }
  });

  it('returns email_already_taken when the email exists', async () => {
    const repo = createInMemoryUserRepository();
    await createUser(repo, payload);

    const result = await createUser(repo, payload);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, 'email_already_taken');
      assert.equal(result.error.email, payload.email);
    }
  });

  it('does not call save when the email is already taken', async () => {
    let saveCalls = 0;
    const repo = createInMemoryUserRepository();
    const wrappedRepo = {
      findByEmail: repo.findByEmail,
      save: async (...args: Parameters<typeof repo.save>) => {
        saveCalls += 1;
        return repo.save(...args);
      },
    };

    await createUser(wrappedRepo, payload);
    await createUser(wrappedRepo, payload);

    assert.equal(saveCalls, 1);
  });
});
