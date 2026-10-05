/**
 * Self-managed Atlassian OAuth 2.0 (3LO).
 *
 * Forge External Auth (`providers.auth`) rejects Atlassian OAuth clients, so the
 * authorization-code flow is implemented here: a web trigger receives the
 * redirect and tokens are kept in Forge secret storage, scoped per Jira user.
 */

/** Minimal subset of Forge `storage` used by the OAuth flow. */
export interface KeyValueStore {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  getSecret(key: string): Promise<any>;
  setSecret(key: string, value: any): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<HttpResponse>;

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  /** Must exactly match a callback URL registered in the developer console. */
  redirectUri: string;
  scopes: string[];
}

/** Non-secret metadata about a connected Atlassian identity. */
export interface ConnectedAccount {
  id: string;
  email: string;
  name?: string;
  connectedAt: number;
}

/** Stored in Forge secret storage only. */
export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  /** Epoch millis. */
  expiresAt: number;
  scope?: string;
}

/** Pending authorization attempt, keyed by the random `state` value. */
export interface PendingState {
  userId: string;
  createdAt: number;
}
