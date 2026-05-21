// Realistic-looking example of @log and @timed applied to a service class.
// Run with `npm start` after `npm run build` (compiles TS → ES2022 JS).

// Note: `.js` extension is the Node ESM idiom — TS resolves to .ts at
// type-check time, and `tsc` emits matching .js with the same extension.
import { log } from './log.js';
import { timed } from './timed.js';

type UserId = string;
type User = { id: UserId; name: string; email: string };

class UserService {
  private users: Map<UserId, User> = new Map();

  @log
  add(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  @log
  findById(id: UserId): User | undefined {
    return this.users.get(id);
  }

  @timed
  @log
  async findByEmailSlow(email: string): Promise<User | undefined> {
    // Simulate network/IO latency.
    await new Promise((r) => setTimeout(r, 80));
    return [...this.users.values()].find((u) => u.email === email);
  }
}

// ------------------------------ Demo ------------------------------

const service = new UserService();

service.add({ id: '1', name: 'Jose', email: 'jose@example.com' });
service.add({ id: '2', name: 'Maria', email: 'maria@example.com' });

service.findById('1');
service.findById('missing');

await service.findByEmailSlow('maria@example.com');
await service.findByEmailSlow('nobody@example.com');
