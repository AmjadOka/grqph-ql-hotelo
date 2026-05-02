import DataLoader from 'dataloader';
import { Injectable, Scope } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from 'src/user/user.schema';
import { Model } from 'mongoose';

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  public readonly batch = new DataLoader(async (ids: readonly string[]) => {
    const users = await this.userModel.find({
      _id: { $in: ids },
    });

    const map = new Map(users.map((u) => [u._id.toString(), u]));

    return ids.map((id) => map.get(id));
  });
}
