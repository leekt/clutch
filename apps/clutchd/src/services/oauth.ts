import { createHash, randomBytes } from 'crypto';
import { URL } from 'url';

import { logger } from '../logger.js';

import { secretStore } from './secret-store.js';

type OAuthStatus = 'pending' | 'received' | 'exchanged' | 'error';

interface OAuthSession {
  state: string;
  codeVerifier: string;
  createdAt: number;
  authUrl: string;
  tokenUrl: string;
  scope: string;
  redirectUrl: string;
  clientId: string;
  code?: string;
  error?: string;
  status: OAuthStatus;
}

class OAuthService {
  private sessions = new Map<string, OAuthSession>();

  private generateState(): string {
    return randomBytes(16).toString('hex');
  }

  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  startCodexOAuth(input?: {
    authUrl?: string;
    tokenUrl?: string;
    scope?: string;
    redirectUrl?: string;
  }): { state: string; authUrl: string; redirectUrl: string } {
    const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
    const authUrlBase = input?.authUrl || 'https://auth.openai.com/oauth/authorize';
    const tokenUrl = input?.tokenUrl || 'https://auth.openai.com/oauth/token';
    const scope = input?.scope || 'openid profile email offline_access';
    const redirectUrl = input?.redirectUrl || 'http://localhost:1455/auth/callback';

    const state = this.generateState();
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const authUrl = new URL(authUrlBase);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('id_token_add_organizations', 'true');
    authUrl.searchParams.set('codex_cli_simplified_flow', 'true');
    authUrl.searchParams.set('originator', 'codex_cli_rs');

    this.sessions.set(state, {
      state,
      codeVerifier,
      createdAt: Date.now(),
      authUrl: authUrlBase,
      tokenUrl,
      scope,
      redirectUrl,
      clientId,
      status: 'pending',
    });

    return { state, authUrl: authUrl.toString(), redirectUrl };
  }

  recordCallback(state: string, code?: string, error?: string): void {
    const session = this.sessions.get(state);
    if (!session) {
      logger.warn({ state }, 'OAuth callback received for unknown state');
      return;
    }

    session.code = code;
    session.error = error;
    session.status = error ? 'error' : 'received';
  }

  getStatus(state: string): OAuthStatus {
    const session = this.sessions.get(state);
    if (!session) {
      return 'error';
    }
    return session.status;
  }

  async exchangeCodex(state: string, code?: string, redirectUrl?: string): Promise<{ secretId: string }> {
    const session = this.sessions.get(state);
    if (!session) {
      throw new Error('OAuth session not found');
    }

    const authCode = code ?? session.code;
    if (!authCode) {
      throw new Error('OAuth code not available');
    }

    if (redirectUrl) {
      try {
        const parsed = new URL(redirectUrl);
        session.redirectUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch {
        // Ignore invalid redirectUrl
      }
    }

    const response = await fetch(session.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: session.clientId,
        code: authCode,
        code_verifier: session.codeVerifier,
        redirect_uri: session.redirectUrl,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown');
      session.status = 'error';
      session.error = body;
      throw new Error(`OAuth token exchange failed: ${body}`);
    }

    const token = (await response.json()) as Record<string, unknown>;
    const secretId = await secretStore.createSecret(JSON.stringify(token), 'codex-oauth-token');

    session.status = 'exchanged';
    return { secretId };
  }
}

export const oauthService = new OAuthService();
