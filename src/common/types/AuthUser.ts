import { UserRole } from 'src/user/user.schema';

export type AuthUser = {
  _id: string;
  role: UserRole;
};
