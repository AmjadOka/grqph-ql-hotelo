import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Review } from '../../review/review.schema';
import { Cabin } from '../../cabin/cabin.schema';

@Injectable()
export class CabinStatsService {
  constructor(
    @InjectModel(Review.name) private reviewModel: Model<Review>,
    @InjectModel(Cabin.name) private cabinModel: Model<Cabin>,
  ) {}

  async recompute(cabin: string) {
    const cabinId = new Types.ObjectId(cabin);
    const [stats] = await this.reviewModel.aggregate([
      {
        $match: {
          cabinId: cabinId,
        },
      },
      {
        $group: {
          _id: null,
          ratingAvg: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    const ratingAvg =
      stats?.ratingAvg != null
        ? Math.round(Number(stats.ratingAvg) * 10) / 10
        : 0;

    const ratingCount = stats?.count ?? 0;

    await this.cabinModel.findByIdAndUpdate(
      cabinId,
      {
        ratingAvg,
        ratingCount,
      },
      { new: true },
    );

    return { ratingAvg, ratingCount };
  }
}
