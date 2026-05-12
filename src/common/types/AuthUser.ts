import { UserRole } from 'src/user/user.schema';

export type AuthUser = {
  sub: string;
  role: UserRole;
  type: 'access' | 'refresh';
};
