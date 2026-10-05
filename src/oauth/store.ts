import { ConnectedAccount, KeyValueStore, PendingState, StoredToken } from './types';

/** Pending authorizations expire after 10 minutes. */
export const STATE_TTL_MS = 10 * 60 * 1000;
/** Sign-in attempts a user can have open at once (e.g. own tab + private window). */
export const MAX_PENDING_STATES = 3;

const accountsKey = (userId: string) => `oauth-accounts:${userId}`;
const tokenKey = (userId: string, accountId: string) => `oauth-token:${userId}:${accountId}`;
const stateKey = (state: string) => `oauth-state:${state}`;
const userStatesKey = (userId: string) => `oauth-user-states:${userId}`;

export class OAuthStore {
  constructor(private readonly kv: KeyValueStore) {}

  async listAccounts(userId: string): Promise<ConnectedAccount[]> {
    const list = await this.kv.get(accountsKey(userId));
    return Array.isArray(list) ? list : [];
  }

  async saveAccount(userId: string, account: ConnectedAccount, token: StoredToken): Promise<void> {
    await this.kv.setSecret(tokenKey(userId, account.id), token);
    const others = (await this.listAccounts(userId)).filter(a => a.id !== account.id);
    await this.kv.set(accountsKey(userId), [...others, account]);
  }

  async removeAccount(userId: string, accountId: string): Promise<void> {
    await this.kv.deleteSecret(tokenKey(userId, accountId));
    const remaining = (await this.listAccounts(userId)).filter(a => a.id !== accountId);
    await this.kv.set(accountsKey(userId), remaining);
  }

  async getToken(userId: string, accountId: string): Promise<StoredToken | undefined> {
    return (await this.kv.getSecret(tokenKey(userId, accountId))) || undefined;
  }

  async setToken(userId: string, accountId: string, token: StoredToken): Promise<void> {
    await this.kv.setSecret(tokenKey(userId, accountId), token);
  }

  /**
   * Stores a pending authorization. Only the newest MAX_PENDING_STATES per
   * user stay valid; older ones are deleted so abandoned attempts don't
   * accumulate (storage has no TTL).
   */
  async createState(state: string, userId: string, now: number): Promise<void> {
    const pending: PendingState = { userId, createdAt: now };
    await this.kv.setSecret(stateKey(state), pending);

    const previous = await this.kv.getSecret(userStatesKey(userId));
    const recent = [...(Array.isArray(previous) ? previous : []), state];
    const stale = recent.slice(0, Math.max(0, recent.length - MAX_PENDING_STATES));
    await Promise.all(stale.map(s => this.kv.deleteSecret(stateKey(s))));
    await this.kv.setSecret(userStatesKey(userId), recent.slice(-MAX_PENDING_STATES));
  }

  /**
   * Returns the pending state and deletes it, so each state is single-use.
   * Expired or unknown states yield `undefined`.
   */
  async consumeState(state: string, now: number): Promise<PendingState | undefined> {
    const pending = (await this.kv.getSecret(stateKey(state))) as PendingState | undefined;
    if (!pending) return undefined;
    await this.kv.deleteSecret(stateKey(state));
    if (now - pending.createdAt > STATE_TTL_MS) return undefined;
    return pending;
  }
}
