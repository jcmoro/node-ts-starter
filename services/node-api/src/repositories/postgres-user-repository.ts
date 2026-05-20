import type { PostgresClient } from '../db/postgres.ts';
import { UserSchema } from '../domain/user.ts';
import type { UserRepository } from './user-repository.ts';

export function createPostgresUserRepository(sql: PostgresClient): UserRepository {
  return {
    async findByEmail(email) {
      const rows = await sql`
        SELECT id, email, name FROM users WHERE email = ${email}
      `;
      if (rows.length === 0) return null;
      return UserSchema.parse(rows[0]);
    },

    async save(user) {
      await sql`
        INSERT INTO users (id, email, name)
        VALUES (${user.id}, ${user.email}, ${user.name})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      `;
    },
  };
}
