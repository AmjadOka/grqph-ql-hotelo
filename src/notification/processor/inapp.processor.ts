import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Notification } from '../notification.schema';
import {
  NOTIFICATION_QUEUE,
  NotificationJobs,
  InAppJobPayload,
} from '../types/notification.types';
import { NotificationGateway } from '../gateways/notification.gateway';

@Processor(NOTIFICATION_QUEUE)
export class InAppProcessor extends WorkerHost {
  private readonly logger = new Logger(InAppProcessor.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,

    // FIX: inject gateway directly — EventEmitter2 hop was broken
    // (nothing was listening to 'notification.push' on the gateway)
    private readonly gateway: NotificationGateway,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== NotificationJobs.IN_APP) return;

    const payload = job.data as InAppJobPayload;
    this.logger.debug(
      `Processing IN_APP job [${job.id}] for user ${payload.userId} type=${payload.type}`,
    );

    try {
      const notification = await this.notificationModel.create({
        userId: new Types.ObjectId(payload.userId),
        type: payload.type,
        title: payload.title,
        body: payload.body,
        link: payload.link,
        read: false,
      });

      this.logger.log(
        `DB saved [${notification.id}] → ${payload.userId} [${payload.type}]`,
      );

      this.gateway.pushToUser(payload.userId, notification);

      this.logger.log(`WS pushed → ${payload.userId} [${payload.type}]`);
    } catch (err) {
      this.logger.error(
        `IN_APP job failed [${job.id}] user=${payload.userId} type=${payload.type}`,
        err,
      );
      throw err; // rethrow so BullMQ retries and marks it failed
    }
  }
}
