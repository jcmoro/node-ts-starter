// OBJECT-ORIENTED STYLE — same domain, OO modelling.
//
// - Branded values as classes with private constructors + static factories.
// - User as a class with parameter properties (TS-only shortcut) + readonly fields.
// - Repository as an abstract base class with a shared findByIdOrThrow,
//   leaving findById / save abstract for subclasses to implement.

// ----------------------------- Value objects -----------------------------

export class Email {
  // Private constructor: callers must go through the factory below.
  private constructor(public readonly value: string) {}

  static fromRaw(raw: string): Email | null {
    const normalised = raw.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) return null;
    return new Email(normalised);
  }

  toString(): string {
    return this.value;
  }
}

export class UserId {
  private constructor(public readonly value: string) {}

  static fromUUID(value: string): UserId {
    if (!/^[0-9a-f-]{36}$/i.test(value)) {
      throw new Error(`Invalid UUID: ${value}`);
    }
    return new UserId(value);
  }

  static generate(): UserId {
    return new UserId(crypto.randomUUID());
  }
}

// ----------------------------- Entity -----------------------------

export class User {
  // Parameter properties: declare + initialise + scope in one line.
  constructor(
    public readonly id: UserId,
    public readonly email: Email,
    public readonly name: string,
  ) {}

  static newWith(input: { email: Email; name: string }): User {
    return new User(UserId.generate(), input.email, input.name);
  }

  // Domain method — natural fit for a class. In the functional style this
  // would be a free function `displayName(user: User): string`.
  displayName(): string {
    return `${this.name} <${this.email.value}>`;
  }
}

// ----------------------------- Repository -----------------------------

export abstract class UserRepository {
  // Subclasses implement the I/O. Abstract methods have no body and force
  // overrides; without them, the class would be instantiable as-is.
  abstract findById(id: UserId): Promise<User | null>;
  abstract save(user: User): Promise<User>;

  // Shared default — no override needed in subclasses, inherited for free.
  async findByIdOrThrow(id: UserId): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new Error(`User ${id.value} not found`);
    return user;
  }
}

export class InMemoryUserRepository extends UserRepository {
  private readonly store = new Map<string, User>();

  override async findById(id: UserId): Promise<User | null> {
    return this.store.get(id.value) ?? null;
  }

  override async save(user: User): Promise<User> {
    this.store.set(user.id.value, user);
    return user;
  }
}
