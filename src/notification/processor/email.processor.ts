import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import {
  NOTIFICATION_QUEUE,
  NotificationJobs,
  EmailJobPayload,
} from '../types/notification.types';
import { Resend } from 'resend';

/**
 * EmailProcessor
 *
 * Runs in the BullMQ worker context — separate from the HTTP process
 * if you scale workers independently.
 *
 * Templates live in src/notifications/templates/*.hbs
 * Each templateId maps to a file: e.g. 'booking-confirmed' → booking-confirmed.hbs
 */
@Processor(NOTIFICATION_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    super();

    this.from = config.get<string>('MAIL_FROM')!;

    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
      secure: config.get<boolean>('SMTP_SECURE', false),
      auth: {
        user: config.get<string>('SMTP_USER'),
        pass: config.get<string>('SMTP_PASS'),
      },
    });
  }

  async process(job: Job): Promise<void> {
    // Only handle email jobs — in-app jobs are handled by InAppProcessor
    if (job.name !== NotificationJobs.EMAIL) return;

    const payload = job.data as EmailJobPayload;

    try {
      const html = this.renderTemplate(
        payload.templateId,
        payload.templateData,
      );
      const resend = new Resend('re_dmxcRuiE_HSNv2hk8pemXJV1SdZdTxPeY');

      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: 'amjad392q@gmail.com',
        subject: 'Hello World',
        html: html,
      });

      /**
     
    
    await this.transporter.sendMail({
        from: this.from,
        to: payload.to,
        subject: payload.subject,
        html,
      });
    
    
    */

      this.logger.log(`Email sent → ${payload.to} [${payload.type}]`);
    } catch (err) {
      this.logger.error(`Email failed → ${payload.to} [${payload.type}]`, err);
      throw err; // rethrow so BullMQ retries the job
    }
  }

  /**
   * Compiles and renders a Handlebars template.
   * Templates are cached after first load.
   */
  private readonly templateCache = new Map<
    string,
    handlebars.TemplateDelegate
  >();

  private renderTemplate(
    templateId: string,
    data: Record<string, unknown>,
  ): string {
    if (!this.templateCache.has(templateId)) {
      const filePath = path.join(
        process.cwd(),
        'src',
        'notification',
        'templates',
        `${templateId}.hbs`,
      );

      const source = fs.readFileSync(filePath, 'utf-8');
      this.templateCache.set(templateId, handlebars.compile(source));
    }

    return this.templateCache.get(templateId)!(data);
  }
}
