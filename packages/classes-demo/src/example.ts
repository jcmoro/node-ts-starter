// Side-by-side demo: same use case, two styles.

import * as fn from './user-functional.js';
import * as oo from './user-oo.js';

console.log('======== Functional style ========');

const fnEmail = fn.makeEmail('jose@example.com');
if (!fnEmail) throw new Error('invalid email');

const fnUser = fn.newUser({ email: fnEmail, name: 'Jose' });
const fnRepo = fn.createInMemoryUserRepository();
await fnRepo.save(fnUser);
const fnLoaded = await fnRepo.findById(fnUser.id);
console.log('loaded:', fnLoaded);

console.log('\n======== OO style ========');

const ooEmail = oo.Email.fromRaw('jose@example.com');
if (!ooEmail) throw new Error('invalid email');

const ooUser = oo.User.newWith({ email: ooEmail, name: 'Jose' });
const ooRepo = new oo.InMemoryUserRepository();
await ooRepo.save(ooUser);
const ooLoaded = await ooRepo.findById(ooUser.id);
console.log('loaded:', ooLoaded);
console.log('displayName():', ooUser.displayName());

// findByIdOrThrow inherited from abstract base
try {
  await ooRepo.findByIdOrThrow(oo.UserId.fromUUID('00000000-0000-0000-0000-000000000000'));
} catch (e) {
  console.log('expected throw:', (e as Error).message);
}
