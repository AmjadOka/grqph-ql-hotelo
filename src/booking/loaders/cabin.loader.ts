import DataLoader from 'dataloader';
import { Injectable, Scope } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cabin } from 'src/cabin/cabin.schema';
@Injectable({ scope: Scope.REQUEST })
export class CabinLoader {
  constructor(
    @InjectModel(Cabin.name)
    private cabinModel: Model<Cabin>,
  ) {}

  public readonly batch = new DataLoader(async (ids: readonly string[]) => {
    const cabins = await this.cabinModel.find({
      _id: { $in: ids },
    });

    const map = new Map(cabins.map((c) => [c._id.toString(), c]));

    return ids.map((id) => map.get(id));
  });
}
