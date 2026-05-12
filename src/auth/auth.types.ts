import { UserRole } from 'src/user/user.schema';

/**
 * SafeUser
 *
 * Stripped-down user object safe to return in API responses.
 * Never includes: password, refreshTokenHash, resetCode, or any reset fields.
 */
export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  avatar: string | undefined;
  active: boolean;
}
