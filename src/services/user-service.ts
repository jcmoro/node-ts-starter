import { type CreateUser, type Email, type User, newUserId } from '../domain/user.ts';
import { type Result, err, ok } from '../lib/result.ts';
import { withSpan } from '../lib/with-span.ts';
import type { UserRepository } from '../repositories/user-repository.ts';

export type UserError = { kind: 'email_already_taken'; email: Email };

export function createUser(
  repo: UserRepository,
  payload: CreateUser,
): Promise<Result<User, UserError>> {
  // Manual span: wraps the business operation, not the HTTP boundary. The
  // span name is the domain verb (`user.create`), not the route. With OTel
  // disabled (tests) this is a no-op pass-through.
  return withSpan('user.create', async (span) => {
    const existing = await repo.findByEmail(payload.email);
    if (existing) {
      span.setAttribute('user.outcome', 'email_already_taken');
      return err({ kind: 'email_already_taken', email: payload.email });
    }

    const user: User = { id: newUserId(), ...payload };
    await repo.save(user);

    span.setAttributes({
      'user.outcome': 'created',
      'user.id': user.id,
    });
    return ok(user);
  });
}
