import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Notification } from './notification.schema';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from 'src/user/user.schema';

@Resolver(() => Notification)
export class NotificationResolver {
  constructor(private readonly service: NotificationService) {}

  /** Get last 50 notifications for the logged-in user */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Query(() => [Notification])
  async myNotifications(@CurrentUser('sub') userId: string) {
    return this.service.findForUser(userId);
  }

  /** Count of unread notifications (for the bell badge) */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Query(() => Int)
  async unreadNotificationCount(@CurrentUser('sub') userId: string) {
    return this.service.unreadCount(userId);
  }

  /** Mark a single notification as read */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Notification)
  async markNotificationRead(
    @Args('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.markRead(id, userId);
  }

  /** Mark all notifications as read */
  @Roles(UserRole.EMPLOYEE, UserRole.MANAGER, UserRole.GUEST)
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  async markAllNotificationsRead(@CurrentUser('sub') userId: string) {
    await this.service.markAllRead(userId);
    return true;
  }
}
