import type { z } from 'zod';
import type { Equal, Expect, Extends, NotEqual, NotExtends } from '../lib/type-test.ts';
import type {
  CreateUser,
  CreateUserSchema,
  Email,
  EmailSchema,
  NonEmptyString,
  NonEmptyStringSchema,
  User,
  UserId,
  UserIdSchema,
  UserSchema,
} from './user.ts';

// Todo `import type` — el archivo es puramente type-level y desaparece
// completamente al strip-types. TS acepta `typeof EmailSchema` incluso sobre
// un import type-only.

export type Tests = [
  // ---------- Distinción nominal ----------
  // El whole point de los brands: estos tres tipos son distinguibles a nivel
  // de tipo aunque en runtime sean strings.
  Expect<NotEqual<Email, string>>,
  Expect<NotEqual<UserId, string>>,
  Expect<NotEqual<NonEmptyString, string>>,
  Expect<NotEqual<Email, UserId>>,
  Expect<NotEqual<Email, NonEmptyString>>,
  Expect<NotEqual<UserId, NonEmptyString>>,
  // ---------- Asimetría direccional ----------
  // Email ES un string (puedes pasar un Email donde se pide string)...
  Expect<Extends<Email, string>>,
  Expect<Extends<UserId, string>>,
  Expect<Extends<NonEmptyString, string>>,
  // ...pero string NO es un Email. Esta dirección es donde brilla el brand:
  // impide pasar un string crudo a una API que pide Email.
  Expect<NotExtends<string, Email>>,
  Expect<NotExtends<string, UserId>>,
  Expect<NotExtends<string, NonEmptyString>>,
  // ---------- Single source of truth schema↔type ----------
  // z.infer extrae el tipo del schema; ese tipo es exactamente el `Email`
  // que exportamos. Si cambias el schema, el tipo se actualiza automáticamente.
  Expect<Equal<z.infer<typeof EmailSchema>, Email>>,
  Expect<Equal<z.infer<typeof UserIdSchema>, UserId>>,
  Expect<Equal<z.infer<typeof NonEmptyStringSchema>, NonEmptyString>>,
  // ---------- Forma del agregado ----------
  Expect<Equal<z.infer<typeof CreateUserSchema>, CreateUser>>,
  Expect<Equal<z.infer<typeof UserSchema>, User>>,
];
