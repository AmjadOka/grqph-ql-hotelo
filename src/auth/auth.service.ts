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
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from 'src/user/user.schema';
import { SignUpInput } from './dto/sign-up.input';
import { SignInInput } from './dto/sign-in.input';
import { SafeUser } from './auth.types';
import { EventEmitter2 } from '@nestjs/event-emitter';

const SALT_ROUNDS = 10;
const MAX_RESET_ATTEMPTS = 3;

// ─── Token payload types ────────────────────────────────────────────────────

interface TokenPayload {
  sub: string; // standard JWT subject claim (userId)
  role: UserRole;
  type: 'access' | 'refresh'; // prevents refresh token being used as access token
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService, // FIX 1: inject ConfigService to use explicit secrets
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /* =====================================================
     TOKEN HELPERS
  ===================================================== */

  private async generateTokens(userId: string, role: UserRole) {
    const accessPayload: TokenPayload = { sub: userId, role, type: 'access' };
    const refreshPayload: TokenPayload = { sub: userId, role, type: 'refresh' };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '1d',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  /**
   * Hash refresh token before saving in DB.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private sanitizeUser(user: User): SafeUser {
    return {
      id: user.id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      avatar: user.avatar ?? '',
      active: user.active,
    };
  }

  /* =====================================================
     SIGN UP
  ===================================================== */

  async signUp(signUpDto: SignUpInput) {
    const existingUser = await this.userModel.findOne({
      email: signUpDto.email,
    });

    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(signUpDto.password, SALT_ROUNDS);

    const newUser = await this.userModel.create({
      email: signUpDto.email,
      fullName: signUpDto.name,
      password: hashedPassword,
      role: UserRole.GUEST,
      active: true,
    });

    const tokens = await this.generateTokens(
      newUser._id.toString(),
      newUser.role,
    );

    newUser.refreshTokenHash = this.hashToken(tokens.refreshToken);
    await newUser.save();

    this.eventEmitter.emit('user.registered', {
      userId: newUser._id.toString(),
      email: newUser.email,
      fullName: newUser.fullName,
    });
    return {
      status: 201,
      message: 'User registered successfully',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /* =====================================================
     SIGN IN
  ===================================================== */

  async signIn(signInDto: SignInInput) {
    const user = await this.userModel.findOne({ email: signInDto.email });

    if (!user || !(await bcrypt.compare(signInDto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const tokens = await this.generateTokens(user.id.toString(), user.role);

    // Rotate refresh token on every login
    user.refreshTokenHash = this.hashToken(tokens.refreshToken);
    await user.save();
    return {
      status: 200,
      message: 'Login successful',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      data: this.sanitizeUser(user),
    };
  }

  /* =====================================================
     REFRESH TOKEN
  ===================================================== */

  async refreshToken(refreshToken: string) {
    let payload: TokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<TokenPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.userModel.findById(payload.sub);

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException(
        'Session not found — please log in again',
      );
    }

    const hashed = this.hashToken(refreshToken);

    if (hashed !== user.refreshTokenHash) {
      // Token reuse detected — wipe all sessions (security: refresh token rotation attack)
      user.refreshTokenHash = undefined;
      await user.save();
      throw new UnauthorizedException(
        'Token reuse detected — please log in again',
      );
    }

    const newTokens = await this.generateTokens(user.id.toString(), user.role);

    // Rotate refresh token
    user.refreshTokenHash = this.hashToken(newTokens.refreshToken);
    await user.save();

    return {
      status: 200,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    };
  }

  /* =====================================================
     LOGOUT
  ===================================================== */

  async logout(userId: string) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    await this.userModel.updateOne(
      { _id: user.id },
      { $unset: { refreshTokenHash: 1 } },
    );

    return {
      status: 200,
      message: 'Logged out successfully',
    };
  }

  /* =====================================================
     PASSWORD RESET — Step 1: Send Code
  ===================================================== */

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

    user.resetCode = code;
    user.resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    user.resetAttempts = 0;
    user.isResetVerified = false;
    user.resetLastSentAt = new Date();

    await user.save();

    // TODO: inject MailService and send email here
    // await this.mailService.sendResetCode(email, code);

    return {
      status: 200,
      message: 'If the email exists, a reset code was sent.',
    };
  }

  /* =====================================================
     PASSWORD RESET — Step 2: Verify Code
  ===================================================== */

  async verifyResetCode(email: string, code: string) {
    const user = await this.userModel.findOne({
      email,
      resetExpires: { $gt: new Date() }, // only fetch non-expired
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired code');
    }

    if ((user.resetAttempts ?? 0) >= MAX_RESET_ATTEMPTS) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new code.',
      );
    }

    if (user.resetCode !== code) {
      user.resetAttempts = (user.resetAttempts ?? 0) + 1;
      await user.save();

      const attemptsLeft = MAX_RESET_ATTEMPTS - user.resetAttempts;
      throw new BadRequestException(
        `Invalid code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`,
      );
    }

    user.isResetVerified = true;
    user.resetAttempts = 0;
    await user.save();

    return {
      status: 200,
      message: 'Code verified successfully',
    };
  }

  /* =====================================================
     PASSWORD RESET — Step 3: Change Password
  ===================================================== */

  async changePassword(email: string, newPassword: string) {
    const user = await this.userModel.findOne({ email });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isResetVerified) {
      throw new BadRequestException('Reset code not verified');
    }

    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Invalidate all active sessions after password change
    user.refreshTokenHash = undefined;

    // Full cleanup
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
