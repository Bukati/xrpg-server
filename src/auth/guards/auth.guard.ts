import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string;
  accessToken: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Get authentication from cookies (same origin as backend)
    const accessToken = request.cookies?.x_access_token;
    const userDataRaw = request.cookies?.x_user;

    if (!accessToken || !userDataRaw) {
      throw new UnauthorizedException('No valid session found');
    }

    try {
      // Parse user data from cookie
      const userData = JSON.parse(userDataRaw);

      // Attach user info to request for use in controllers
      request['user'] = {
        id: userData.id,
        username: userData.username,
        name: userData.name,
        profileImageUrl: userData.profile_image_url,
        accessToken,
      } as AuthenticatedUser;

      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid session data');
    }
  }
}
