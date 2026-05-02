import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { AuthService } from './auth.service';

import { SignUpInput } from './dto/sign-up.input';
import { SignInInput } from './dto/sign-in.input';
import { AuthResponse, MessageResponse } from './dto/auth-response.type';
import {
  ChangePasswordInput,
  ResetPasswordInput,
  VerifyCodeInput,
} from './dto/change-password.dto';

/**
 * AuthResolver
 *
 * GraphQL layer for authentication operations.
 *
 * Responsibilities:
 * - User registration (signUp)
 * - Login (signIn)
 * - Refresh token exchange
 * - Logout
 * - Password reset flow
 *
 * NOTE:
 * This resolver only handles request/response mapping.
 * All security logic is inside AuthService.
 */

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  /* =====================================================
     SIGN UP
  ===================================================== */

  /**
   * Registers a new user and returns:
   * - accessToken
   * - refreshToken
   */
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

  /**
   * Authenticates user and returns JWT tokens
   */
  @Mutation(() => AuthResponse)
  async login(@Args('input') input: SignInInput) {
    const res = await this.authService.signIn(input);
    console.log(res);
    return {
      status: res.status,
      message: 'Login successful',
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      data: null,
    };
  }

  /* =====================================================
     REFRESH TOKEN
  ===================================================== */

  /**
   * Exchanges refresh token for new access + refresh tokens
   */
  @Mutation(() => AuthResponse)
  async refreshToken(@Args('refreshToken') refreshToken: string) {
    const res = await this.authService.refreshToken(refreshToken);

    return {
      status: res.status,
      message: 'Token refreshed successfully',
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      data: null,
    };
  }

  /* =====================================================
     LOGOUT
  ===================================================== */

  /**
   * Invalidates refresh token (server-side logout)
   */
  @Mutation(() => MessageResponse)
  async logout(@Args('userId') userId: string) {
    return this.authService.logout(userId);
  }

  /* =====================================================
     PASSWORD RESET FLOW
  ===================================================== */

  /**
   * Step 1:
   * Send password reset code to user's email
   */
  @Mutation(() => MessageResponse)
  async resetPassword(@Args('input') input: ResetPasswordInput) {
    return this.authService.resetPassword(input.email);
  }

  /**
   * Step 2:
   * Verify reset code before allowing password change
   */
  @Mutation(() => MessageResponse)
  async verifyCode(@Args('input') input: VerifyCodeInput) {
    return this.authService.verifyResetCode(input.email, input.code);
  }

  /**
   * Step 3:
   * Change password after successful verification
   *
   * IMPORTANT:
   * Requires verified reset session in service layer
   */
  @Mutation(() => MessageResponse)
  async changePassword(@Args('input') input: ChangePasswordInput) {
    return this.authService.changePassword(input.email, input.newPassword);
  }
}
