import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  private readonly clientId = process.env.TWITTER_CLIENT_ID;
  private readonly clientSecret = process.env.TWITTER_CLIENT_SECRET;
  private readonly redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/x-callback`;
  private readonly frontendUrl =
    process.env.CORS_ORIGIN || 'http://localhost:3000';

  /**
   * Generate PKCE code verifier
   */
  generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from verifier
   */
  generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Build X OAuth 2.0 authorization URL
   */
  getAuthorizationUrl(codeChallenge: string, state: string): string {
    if (!this.clientId) {
      throw new Error('TWITTER_CLIENT_ID is not configured');
    }

    const scopes = [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
    ];

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<any> {
    const tokenResponse = await fetch(
      'https://api.twitter.com/2/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${this.clientId}:${this.clientSecret}`,
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri,
          code_verifier: codeVerifier,
        }),
      },
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      throw new Error(`Token exchange failed: ${JSON.stringify(error)}`);
    }

    return tokenResponse.json();
  }

  /**
   * Refresh an expired access token using the refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }> {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${this.clientId}:${this.clientSecret}`,
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId!,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${JSON.stringify(error)}`);
    }

    return response.json();
  }

  /**
   * Get user profile from X API
   */
  async getUserProfile(accessToken: string): Promise<any> {
    const userResponse = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,public_metrics',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!userResponse.ok) {
      const error = await userResponse.json();
      throw new Error(`Failed to get user profile: ${JSON.stringify(error)}`);
    }

    return userResponse.json();
  }
}
