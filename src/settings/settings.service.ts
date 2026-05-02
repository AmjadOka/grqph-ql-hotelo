import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings } from './settings.schema';
import { UpdateSettingsInput } from './dto/update-setting.input';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Settings.name) private settingsModel: Model<Settings>,
  ) {}

  async getSettings(): Promise<Settings> {
    let settings = await this.settingsModel.findOne();

    // Create default settings if none exist (useful for first-time setup)
    if (!settings) {
      settings = await this.settingsModel.create({});
    }
    return settings;
  }

  async update(input: UpdateSettingsInput): Promise<Settings> {
    // findOneAndUpdate with an empty filter {} targets the first/only document
    return this.settingsModel.findOneAndUpdate({}, input, {
      returnDocument: 'after',
      upsert: true, // Create if it doesn't exist
    });
  }
}
