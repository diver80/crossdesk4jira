import { ConnectedAccount, KeyValueStore, PendingState, StoredToken } from './types';

/** Pending authorizations expire after 10 minutes. */
export const STATE_TTL_MS = 10 * 60 * 1000;

const accountsKey = (userId: string) => `oauth-accounts:${userId}`;
const tokenKey = (userId: string, accountId: string) => `oauth-token:${userId}:${accountId}`;
const stateKey = (state: string) => `oauth-state:${state}`;

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

  async createState(state: string, userId: string, now: number): Promise<void> {
    const pending: PendingState = { userId, createdAt: now };
    await this.kv.setSecret(stateKey(state), pending);
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
