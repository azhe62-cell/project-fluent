import { ServiceError, type AuthService, type AuthUser } from '../types';
import type { KeyValueStore } from './storage';

/**
 * LOCAL DEVELOPMENT AUTH — NOT REAL AUTHENTICATION.
 * There are no passwords and no server. A "profile" is just a name and email kept in this
 * browser so the app can be explored without a backend. Configure Supabase for real accounts.
 */
const USERS = 'fluent.local.v1.users';
const SESSION = 'fluent.local.v1.session';
export const dataKey = (uid: string) => `fluent.local.v1.data.${uid}`;

type UserMap = Record<string, AuthUser>; // keyed by lower-case email

export class LocalAuthService implements AuthService {
  mode = 'local' as const;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(private store: KeyValueStore) {}

  private users(): UserMap { try { return JSON.parse(this.store.getItem(USERS) ?? '{}'); } catch { return {}; } }
  private emit(u: AuthUser | null) { this.listeners.forEach((l) => l(u)); }

  /** Synchronous, authoritative: the stored session is the single source of truth. */
  sessionUserId(): string | null { return this.store.getItem(SESSION); }

  async getUser() {
    const id = this.store.getItem(SESSION);
    return id ? Object.values(this.users()).find((u) => u.id === id) ?? null : null;
  }
  subscribe(cb: (u: AuthUser | null) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  async signUp(i: { email: string; displayName: string }) {
    const email = i.email.trim().toLowerCase();
    const users = this.users();
    if (users[email]) throw new ServiceError('auth', 'A local profile with that email already exists on this device. Try signing in.');
    const user: AuthUser = { id: crypto.randomUUID(), email, displayName: i.displayName.trim() };
    users[email] = user;
    this.store.setItem(USERS, JSON.stringify(users));
    this.store.setItem(SESSION, user.id);
    this.emit(user);
    return { user, needsEmailVerification: false };
  }
  async signIn(i: { email: string }) {
    const user = this.users()[i.email.trim().toLowerCase()];
    if (!user) throw new ServiceError('auth', 'No local profile with that email on this device.');
    this.store.setItem(SESSION, user.id);
    this.emit(user);
    return user;
  }
  async signOut() { this.store.removeItem(SESSION); this.emit(null); }
  async requestPasswordReset(): Promise<void> {
    throw new ServiceError('not_implemented', 'Password reset needs real accounts. Configure Supabase to enable it.');
  }
  async updatePassword(): Promise<void> {
    throw new ServiceError('not_implemented', 'Local demo profiles have no passwords.');
  }
  async updateDisplayName(name: string) {
    const me = await this.getUser();
    if (!me) throw new ServiceError('unauthenticated', 'Not signed in.');
    const users = this.users();
    const updated = { ...me, displayName: name.trim() };
    users[me.email] = updated;
    this.store.setItem(USERS, JSON.stringify(users));
    this.emit(updated);
    return updated;
  }
  async deleteAccount() {
    const me = await this.getUser();
    if (!me) return;
    const users = this.users(); delete users[me.email];
    this.store.setItem(USERS, JSON.stringify(users));
    this.store.removeItem(dataKey(me.id));
    this.store.removeItem(SESSION);
    this.emit(null);
  }
}
