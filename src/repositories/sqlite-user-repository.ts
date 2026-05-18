import type { DatabaseSync } from 'node:sqlite';
import { UserSchema } from '../domain/user.ts';
import type { UserRepository } from './user-repository.ts';

export function createSqliteUserRepository(db: DatabaseSync): UserRepository {
  const findStmt = db.prepare('SELECT id, email, name FROM users WHERE email = ?');
  const saveStmt = db.prepare(
    `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name`,
  );

  // node:sqlite finalises every prepared statement when the underlying
  // DatabaseSync is garbage-collected, and StatementSync doesn't back-reference
  // DatabaseSync at the JS level. We pin `db` as a (non-public) property of
  // the repo so it survives as long as the repo does — otherwise we hit
  // ERR_INVALID_STATE intermittently under GC pressure (most reliably
  // reproducible with `--experimental-test-coverage`, which allocates more).
  const repo: UserRepository & { readonly db: DatabaseSync } = {
    db,
    async findByEmail(email) {
      const row = findStmt.get(email);
      if (!row) return null;
      return UserSchema.parse(row);
    },
    async save(user) {
      saveStmt.run(user.id, user.email, user.name);
    },
  };

  return repo;
}
