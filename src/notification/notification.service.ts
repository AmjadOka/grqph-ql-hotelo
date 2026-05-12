import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification } from './notification.schema';
import {
  NOTIFICATION_QUEUE,
  NotificationJobs,
  EmailJobPayload,
  InAppJobPayload,
} from './types/notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue,

    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  /* ─────────────────────────────────────────────────────
     DISPATCH HELPERS — called by event listeners
  ───────────────────────────────────────────────────── */

  /**
   * Enqueues an email job.
   * The job is retried up to 3 times with exponential back-off
   * if the SMTP call fails.
   */
  async sendEmail(payload: EmailJobPayload): Promise<void> {
    await this.queue.add(NotificationJobs.EMAIL, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
      removeOnFail: 50, // keep last 50 failed jobs for inspection
    });
  }

  /**
   * Enqueues an in-app notification job.
   */
  async sendInApp(payload: InAppJobPayload): Promise<void> {
    await this.queue.add(NotificationJobs.IN_APP, payload, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 1000 },
      removeOnComplete: true,
    });
  }

  /**
   * Convenience: dispatch  email and in-app .
   */
  async send(email: EmailJobPayload, inApp: InAppJobPayload): Promise<void> {
    const [emailResult, inAppResult] = await Promise.allSettled([
      this.sendEmail(email),
      this.sendInApp(inApp),
    ]);

    if (emailResult.status === 'rejected') {
      this.logger.error(
        `Failed to queue email job [${email.type}] → ${email.to}`,
        emailResult.reason,
      );
    }

    if (inAppResult.status === 'rejected') {
      this.logger.error(
        `Failed to queue in-app job [${inApp.type}] → ${inApp.userId}`,
        inAppResult.reason,
      );
    }
  }

  /* ─────────────────────────────────────────────────────
     READ — GRAPHQL / REST
  ───────────────────────────────────────────────────── */

  async findForUser(userId: string): Promise<Notification[]> {
    return this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      read: false,
    });
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const n = await this.notificationModel.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { read: true } },
      { new: true },
    );

    if (!n) throw new Error('Notification not found');

    return n;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), read: false },
      { $set: { read: true } },
    );
  }
}
