import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { SettingsService } from './settings.service';
import { Settings } from './settings.schema';
import { UseGuards } from '@nestjs/common';
import { UserRole } from '../user/user.schema';
import { GqlAuthGuard } from 'src/common/guards/gql-auth.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UpdateSettingsInput } from './dto/update-setting.input';

@Resolver(() => Settings)
export class SettingsResolver {
  constructor(private readonly settingsService: SettingsService) {}

  @Query(() => Settings, { name: 'settings' })
  async getSettings() {
    return this.settingsService.getSettings();
  }

  @Mutation(() => Settings)
  @Roles(UserRole.MANAGER)
  @UseGuards(GqlAuthGuard)
  async updateSettings(@Args('input') input: UpdateSettingsInput) {
    return this.settingsService.update(input);
  }
}
