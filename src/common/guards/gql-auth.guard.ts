import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from 'src/user/user.schema';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const req = ctx.getContext()?.req;

    if (!req) {
      throw new UnauthorizedException('Request not found');
    }

    const token = this.getToken(req);

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const secret = this.config.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    let payload: any;

    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret,
      });
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Attach user to request
    req.user = payload;

    // Role check
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role restriction → allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Super admin override
    // if (payload.role === UserRole.MANAGER) {
    // return true;
    // }

    if (!requiredRoles.includes(payload.role)) {
      throw new ForbiddenException('You do not have permission');
    }

    return true;
  }

  private getToken(req: any): string | null {
    const authHeader = req.headers?.authorization;

    if (!authHeader) return null;

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) return null;

    return token;
  }
}
