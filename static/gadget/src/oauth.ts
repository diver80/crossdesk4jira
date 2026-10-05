import { invoke, router } from '@forge/bridge';

export interface ConnectedAccount {
  id: string;
  email: string;
  name?: string;
}

/**
 * Starts the Atlassian OAuth flow in a new browser tab. The consent result
 * arrives at the app's web trigger, so the gadget can't observe completion;
 * callers should prompt the user to refresh afterwards.
 *
 * Returns the URL so it can also be opened in a private window to connect a
 * different Atlassian account; the pending state is bound to the Jira user,
 * not to the browser session.
 */
export async function openAtlassianSignIn(): Promise<string> {
  const { authorizeUrl } = (await invoke('startOAuth')) as { authorizeUrl: string };
  await router.open(authorizeUrl);
  return authorizeUrl;
}

export const CONNECTED_APPS_URL = 'https://id.atlassian.com/manage-profile/apps';
