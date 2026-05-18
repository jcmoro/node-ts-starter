import { z } from 'zod';

export const EmailSchema = z.string().trim().toLowerCase().email().brand<'Email'>();
export type Email = z.infer<typeof EmailSchema>;

export const UserIdSchema = z.string().uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const NonEmptyStringSchema = z.string().min(1).brand<'NonEmptyString'>();
export type NonEmptyString = z.infer<typeof NonEmptyStringSchema>;

export const CreateUserSchema = z.object({
  email: EmailSchema,
  name: NonEmptyStringSchema,
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UserSchema = z.object({
  id: UserIdSchema,
  email: EmailSchema,
  name: NonEmptyStringSchema,
});
export type User = z.infer<typeof UserSchema>;

export function newUserId(): UserId {
  return crypto.randomUUID() as UserId;
}
