import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from 'src/user/user.schema';
import { SignUpInput } from './dto/sign-up.input';
import { SignInInput } from './dto/sign-in.input';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
  ) {}

  /* =====================================================
     TOKEN HELPERS
  ===================================================== */

  /**
   * Generates access + refresh tokens
   */
  private async generateTokens(payload: { _id: any; role: UserRole }) {
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  /**
   * Hash refresh token before saving in DB
   */
  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /* =====================================================
     SIGN UP
  ===================================================== */

  async signUp(signUpDto: SignUpInput) {
    const existinguser = await this.userModel.findOne({
      email: signUpDto.email,
    });

    if (existinguser) {
      throw new ConflictException('An user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(signUpDto.password, SALT_ROUNDS);

    const newuser = await this.userModel.create({
      ...signUpDto,
      password: hashedPassword,
      fullName: signUpDto.name,
      role: UserRole.GUEST,
      active: true,
    });

    const payload = {
      _id: newuser._id,
      role: newuser.role,
    };

    const tokens = await this.generateTokens(payload);

    /**
     * Store hashed refresh token in DB
     */
    newuser.refreshTokenHash = this.hashToken(tokens.refreshToken);
    await newuser.save();

    return {
      status: 201,
      message: 'user registered successfully',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /* =====================================================
     SIGN IN
  ===================================================== */

  async signIn(signInDto: SignInInput) {
    const user = await this.userModel.findOne({
      email: signInDto.email,
    });

    if (!user || !(await bcrypt.compare(signInDto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      _id: user._id,
      role: user.role,
    };

    const tokens = await this.generateTokens(payload);

    /**
     * Rotate refresh token on login
     */
    user.refreshTokenHash = this.hashToken(tokens.refreshToken);
    await user.save();

    return {
      status: 200,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      data: user,
    };
  }

  /* =====================================================
     REFRESH TOKEN
  ===================================================== */

  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken);

      const user = await this.userModel.findById(payload._id);

      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const hashed = this.hashToken(refreshToken);

      if (hashed !== user.refreshTokenHash) {
        throw new UnauthorizedException('Refresh token mismatch');
      }

      const newTokens = await this.generateTokens({
        _id: user._id,
        role: user.role,
      });

      /**
       * Rotate refresh token (security best practice)
       */
      user.refreshTokenHash = this.hashToken(newTokens.refreshToken);
      await user.save();

      return {
        status: 200,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
      };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /* =====================================================
     LOGOUT
  ===================================================== */

  async logout(userId: string) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    /**
     * Invalidate refresh token
     */
    await this.userModel.updateOne(
      { _id: user._id },
      {
        $unset: {
          refreshTokenHash: 1,
        },
      },
    );
    return {
      status: 200,
      message: 'Logged out successfully',
    };
  }

  // -------------------------------//-------------------------------//
  //-------------------Reset Password-------------------//
  // -------------------------------//-------------------------------//

  /**
   * Step 1:
   * Generate reset code + token
   *
   * Best practice:
   * - Do NOT reveal if email exists
   * - Store expiry (10 minutes)
   * - Store hashed token (never plain token)
   * - Store number of attempts
   */
  async resetPassword(email: string) {
    const user = await this.userModel.findOne({ email });

    if (!user) {
      return {
        status: 200,
        message: 'If the email exists, a reset code was sent.',
      };
    }

    const now = Date.now();

    if (
      user.resetLastSentAt &&
      now - user.resetLastSentAt.getTime() < 60 * 1000
    ) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting another code',
      );
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    /**
     * FULL RESET OF OLD ATTEMPT STATE
     * This is what you were missing
     */
    user.resetCode = code;
    user.resetExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetAttempts = 0;
    user.isResetVerified = false;
    user.resetLastSentAt = new Date();

    await user.save();

    return {
      status: 200,
      message: 'Reset code sent successfully',
    };
  }

  /**
   * Step 2:
   * Verify OTP before allowing password change
   */
  async verifyResetCode(email: string, code: string) {
    const user = await this.userModel.findOne({
      email,
      resetExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired code');
    }

    /**
     * INIT ATTEMPTS IF NULL
     */
    if (user.resetAttempts === undefined || user.resetAttempts === null) {
      user.resetAttempts = 0;
    }

    /**
     * BLOCK AFTER 3 FAILED ATTEMPTS
     */
    if (user.resetExpires && user.resetExpires < new Date()) {
      user.resetAttempts = 0;
      await user.save();
      throw new BadRequestException('Code expired. Request a new one.');
    }

    /**
     * INVALID CODE → increase attempts
     */
    if (user.resetCode !== code) {
      user.resetAttempts += 1;
      await user.save();

      throw new BadRequestException(
        `Invalid code. Attempts left: ${3 - user.resetAttempts}`,
      );
    }

    /**
     * SUCCESS
     */
    user.isResetVerified = true;
    user.resetAttempts = 0;

    await user.save();

    return {
      status: 200,
      message: 'Code verified successfully',
    };
  }

  /**
   * Step 3:
   * Actually change password after verification
   *
   * SECURITY RULES:
   * - Must verify reset first
   * - Must hash password
   * - Must clear reset session
   */
  async changePassword(email: string, newPassword: string) {
    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isResetVerified) {
      throw new BadRequestException('Reset code not verified');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;

    /**
     * FULL CLEANUP AFTER SUCCESS
     */
    user.resetCode = undefined;
    user.resetExpires = undefined;
    user.isResetVerified = false;
    user.resetAttempts = 0;
    user.resetLastSentAt = undefined;

    await user.save();

    return {
      status: 200,
      message: 'Password updated successfully',
    };
  }
}
