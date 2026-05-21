// FUNCTIONAL STYLE — closer to services/node-api/src/domain/user.ts
//
// - Records (type aliases) for shape.
// - Smart constructor functions that validate + brand.
// - Repository as factory returning an object literal (closure over deps).
// - No `class` keyword.

declare const __email: unique symbol;
declare const __userId: unique symbol;

export type Email = string & { readonly [__email]: 'Email' };
export type UserId = string & { readonly [__userId]: 'UserId' };

export type User = {
  readonly id: UserId;
  readonly email: Email;
  readonly name: string;
};

export function makeEmail(raw: string): Email | null {
  const normalised = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised) ? (normalised as Email) : null;
}

export function makeUserId(value: string): UserId {
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
  return value as UserId;
}

export function newUser(input: { email: Email; name: string }): User {
  return {
    id: crypto.randomUUID() as UserId,
    email: input.email,
    name: input.name,
  };
}

// Repository as a factory that closes over a Map (or any backend).
export type UserRepository = {
  findById(id: UserId): Promise<User | null>;
  save(user: User): Promise<User>;
};

export function createInMemoryUserRepository(): UserRepository {
  const store = new Map<UserId, User>();

  return {
    async findById(id: UserId): Promise<User | null> {
      return store.get(id) ?? null;
    },
    async save(user: User): Promise<User> {
      store.set(user.id, user);
      return user;
    },
  };
}
