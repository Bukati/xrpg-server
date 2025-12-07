import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private readonly frontendUrl =
    process.env.CORS_ORIGIN || 'http://localhost:3000';

  /**
   * Initiate X OAuth 2.0 login
   * GET /auth/x-login
   */
  @Get('x-login')
  async xLogin(
    @Query('returnUrl') returnUrl: string,
    @Res() res: Response,
  ) {
    try {
      // Generate PKCE parameters
      const codeVerifier = this.authService.generateCodeVerifier();
      const codeChallenge = this.authService.generateCodeChallenge(codeVerifier);
      const state = Math.random().toString(36).substring(7);

      // Store code_verifier in cookie for callback
      res.cookie('code_verifier', codeVerifier, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600000, // 10 minutes
      });

      // Store state for CSRF protection
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600000, // 10 minutes
      });

      // Store return URL for redirect after login
      if (returnUrl) {
        res.cookie('return_url', returnUrl, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 600000, // 10 minutes
        });
      }

      // Redirect to X authorization URL
      const authUrl = this.authService.getAuthorizationUrl(codeChallenge, state);
      res.redirect(authUrl);
    } catch (error) {
      throw new HttpException(
        `OAuth initiation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Handle X OAuth 2.0 callback
   * GET /auth/x-callback
   */
  @Get('x-callback')
  async xCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      // Handle OAuth errors
      if (error) {
        return res.redirect(`${this.frontendUrl}/login?error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        return res.redirect(`${this.frontendUrl}/login?error=no_code`);
      }

      // Verify state (CSRF protection)
      const savedState = req.cookies?.oauth_state;
      if (!savedState || savedState !== state) {
        return res.redirect(`${this.frontendUrl}/login?error=invalid_state`);
      }

      // Get code_verifier from cookie
      const codeVerifier = req.cookies?.code_verifier;
      if (!codeVerifier) {
        return res.redirect(`${this.frontendUrl}/login?error=missing_code_verifier`);
      }

      // Exchange code for access token
      const tokens = await this.authService.exchangeCodeForToken(code, codeVerifier);

      // Get user profile
      const userData = await this.authService.getUserProfile(tokens.access_token);

      // Clear OAuth state cookies
      res.clearCookie('code_verifier');
      res.clearCookie('oauth_state');

      // Set access token cookie (httpOnly for security)
      res.cookie('x_access_token', tokens.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7200000, // 2 hours
        path: '/',
      });

      // Set refresh token if available
      if (tokens.refresh_token) {
        res.cookie('x_refresh_token', tokens.refresh_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 2592000000, // 30 days
          path: '/',
        });
      }

      // Store user data in a separate cookie (can be read by client)
      res.cookie(
        'x_user',
        JSON.stringify({
          id: userData.data?.id,
          name: userData.data?.name,
          username: userData.data?.username,
          profile_image_url: userData.data?.profile_image_url,
          description: userData.data?.description,
          public_metrics: userData.data?.public_metrics,
        }),
        {
          httpOnly: false, // Client needs to read this
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7200000, // 2 hours
          path: '/',
        },
      );

      // Get return URL from cookie or default to home
      const returnUrl = req.cookies?.return_url || '/';
      res.clearCookie('return_url');

      // Redirect to return URL or home
      res.redirect(`${this.frontendUrl}${returnUrl}`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      return res.redirect(
        `${this.frontendUrl}/login?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  /**
   * Get current session
   * GET /auth/session
   */
  @Get('session')
  async getSession(@Req() req: Request) {
    const userData = req.cookies?.x_user;

    if (!userData) {
      throw new HttpException('No active session', HttpStatus.UNAUTHORIZED);
    }

    try {
      return JSON.parse(userData);
    } catch (error) {
      throw new HttpException('Invalid session data', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Logout
   * POST /auth/logout
   */
  @Post('logout')
  async logout(@Res() res: Response) {
    // Clear all auth cookies
    res.clearCookie('x_access_token');
    res.clearCookie('x_refresh_token');
    res.clearCookie('x_user');

    return res.json({ success: true });
  }
}
