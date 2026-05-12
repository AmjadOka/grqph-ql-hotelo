import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { Notification, NotificationSchema } from './notification.schema';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { NotificationListener } from './listeners/notification.listener';
import { NotificationGateway } from './gateways/notification.gateway';
import { EmailProcessor } from './processor/email.processor';
import { InAppProcessor } from './processor/inapp.processor';
import { User, UserSchema } from '../user/user.schema';
import { NOTIFICATION_QUEUE } from './types/notification.types';
import { ReviewStatsListener } from './listeners/review-stats.listener';
import { CabinStatsService } from './services/cabin-stats.service';
import { Cabin, CabinSchema } from 'src/cabin/cabin.schema';
import { Review, ReviewSchema } from 'src/review/review.schema';

@Module({
  imports: [
    ConfigModule,

    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: Cabin.name, schema: CabinSchema },
      {
        name: Review.name,
        schema: ReviewSchema,
      },
    ]),

    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],

  providers: [
    NotificationService,
    NotificationResolver,
    NotificationListener, // @OnEvent listeners
    NotificationGateway, // WebSocket
    EmailProcessor, // BullMQ worker
    InAppProcessor, // BullMQ worker
    ReviewStatsListener,
    CabinStatsService,
  ],

  exports: [NotificationService],
})
export class NotificationModule {}

/* ─── app.module.ts additions ──────────────────────────────────────────────────

  import { BullModule } from '@nestjs/bullmq';
  import { EventEmitterModule } from '@nestjs/event-emitter';
  import { NotificationModule } from './notifications/notification.module';

  @Module({
    imports: [
      EventEmitterModule.forRoot(),          // already in your app

      BullModule.forRootAsync({              // ADD THIS
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            host: config.get('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
          },
        }),
      }),

      NotificationModule,                    // ADD THIS
      ...
    ],
  })
  export class AppModule {}

────────────────────────────────────────────────────────────────────────────────

  .env additions:

  SMTP_HOST=smtp.resend.com
  SMTP_PORT=465
  SMTP_SECURE=true
  SMTP_USER=resend
  SMTP_PASS=re_xxxxxxxxxxxx
  MAIL_FROM="The Hotel <noreply@yourhotel.com>"

  REDIS_HOST=localhost
  REDIS_PORT=6379

  CLIENT_URL=http://localhost:5173

────────────────────────────────────────────────────────────────────────────────

  Install:

  npm install @nestjs/bullmq bullmq nodemailer handlebars
  npm install --save-dev @types/nodemailer

──────────────────────────────────────────────────────────────────────────────*/
