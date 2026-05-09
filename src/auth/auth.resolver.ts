import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpInput } from './dto/sign-up.input';
import { SignInInput } from './dto/sign-in.input';
import { AuthResponse, MessageResponse } from './dto/auth-response.type';
import {
  ChangePasswordInput,
  ResetPasswordInput,
  VerifyCodeInput,
} from './dto/change-password.dto';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

/**
 * AuthResolver
 *
 * GraphQL layer for authentication operations.
 *
 * Responsibilities:
 * - User registration (signUp)
 * - Login (signIn)
 * - Refresh token exchange
 * - Logout  ← now protected by JWT guard
 * - Password reset flow
 */

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  /* =====================================================
     SIGN UP
  ===================================================== */

  @Mutation(() => AuthResponse)
  async signUp(@Args('input') input: SignUpInput) {
    const res = await this.authService.signUp(input);

    return {
      status: res.status,
      message: res.message,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
    };
  }

  /* =====================================================
     LOGIN
  ===================================================== */

  @Mutation(() => AuthResponse)
  async login(@Args('input') input: SignInInput) {
    const res = await this.authService.signIn(input);

    return {
      status: res.status,
      message: res.message,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      data: res.data,
    };
  }

  /* =====================================================
     REFRESH TOKEN
  ===================================================== */

  @Mutation(() => AuthResponse)
  async refreshToken(@Args('refreshToken') refreshToken: string) {
    const res = await this.authService.refreshToken(refreshToken);

    return {
      status: res.status,
      message: 'Token refreshed successfully',
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
    };
  }

  /* =====================================================
     LOGOUT
  ===================================================== */

  /**
   * verified token via @CurrentUser — never trust client-provided userId.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => MessageResponse)
  async logout(@CurrentUser('sub') userId: string) {
    return this.authService.logout(userId);
  }

  /* =====================================================
     PASSWORD RESET FLOW
  ===================================================== */

  @Mutation(() => MessageResponse)
  async resetPassword(@Args('input') input: ResetPasswordInput) {
    return this.authService.resetPassword(input.email);
  }

  @Mutation(() => MessageResponse)
  async verifyCode(@Args('input') input: VerifyCodeInput) {
    return this.authService.verifyResetCode(input.email, input.code);
  }

  @Mutation(() => MessageResponse)
  async changePassword(@Args('input') input: ChangePasswordInput) {
    return this.authService.changePassword(input.email, input.newPassword);
  }
}
