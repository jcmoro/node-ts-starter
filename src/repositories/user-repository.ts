import type { Email, User } from '../domain/user.ts';

export interface UserRepository {
  findByEmail(email: Email): Promise<User | null>;
  save(user: User): Promise<void>;
}

export function createInMemoryUserRepository(): UserRepository {
  const users = new Map<Email, User>();

  return {
    async findByEmail(email) {
      return users.get(email) ?? null;
    },
    async save(user) {
      users.set(user.email, user);
    },
  };
}
