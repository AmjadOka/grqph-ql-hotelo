import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UserService } from './user.service';
import { User, UserRole } from './user.schema';
import { UpdateUserInput } from './dto/update-user.input';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UsersResponse } from './dto/response-user.dto';
import { UserQueryInput } from './dto/create-user.input';
import type { AuthUser } from 'src/common/types/AuthUser';

/**
 * UserResolver
 *
 * GraphQL layer responsible for exposing user-related operations.
 *
 * Responsibilities:
 * - Query users (admin/manager only)
 * - Fetch single user by ID
 * - Fetch authenticated user profile ("me")
 * - Update user data
 * - Soft delete user
 *
 * This resolver delegates all business logic to UserService.
 */
@Resolver(() => User)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  /**
   * Get all users (Admin/Manager only)
   *
   * Features:
   * - Supports filtering, search, pagination via query object
   * - Protected by role-based access control
   *
   * Security:
   * - authentication (GqlAuthGuard)
   * - private MANAGER role
   *
   * @param query - Optional query filters (search, pagination, etc.)
   * @returns Paginated users response
   */
  @Query(() => UsersResponse)
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  findAllUsers(@Args('query', { nullable: true }) query: UserQueryInput) {
    return this.userService.findAll(query || {});
  }

  /**
   * Get a single user by ID
   *
   * Public or protected depending on global guard configuration.
   *
   * Security:
   * - authentication (GqlAuthGuard)
   * - private MANAGER role
   *
   * @param id - User ObjectId
   * @returns User document
   */
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  @Query(() => User, {
    description: 'Fetch a single user by their unique email or MongoId',
  })
  async getUser(
    @Args('input', { type: () => ID, description: 'enter email or MongoId' })
    input: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.userService.findOneByAdmin(input, user);
  }

  /**
   * Get currently authenticated user ("me endpoint")
   *
   * Used by frontend to load current session profile.
   *
   * Security:
   * - Requires authentication (GqlAuthGuard)
   * - Uses JWT payload via CurrentUser decorator
   *
   * @param user - Injected authenticated user object
   * @returns Current user profile
   */

  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Query(() => User)
  @UseGuards(GqlAuthGuard)
  findMe(@CurrentUser() user: { _id: string; role: UserRole }) {
    return this.userService.findMe(user._id);
  }

  /**
   * Update user profile data
   *
   * Notes:
   * - Does NOT enforce role restriction here (can be extended later)
   * - Supports partial updates via DTO
   *
   * @param id - User ID
   * @param input - Update payload
   * @returns Updated user document
   */

  @Roles(UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => User)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ) {
    return this.userService.update(id, input);
  }

  /**
   * Soft delete user
   *
   * Instead of removing record, marks user as inactive.
   *
   * @param id - User ID
   * @returns Boolean success flag
   */
  @Mutation(() => Boolean)
  async deleteUser(@Args('id', { type: () => ID }) id: string) {
    return this.userService.softDelete(id);
  }
}
