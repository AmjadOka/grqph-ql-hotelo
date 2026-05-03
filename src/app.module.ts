import { Module } from '@nestjs/common';
import { CabinModule } from './cabin/cabin.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { GraphQLModule } from '@nestjs/graphql';
import { MercuriusDriver, MercuriusDriverConfig } from '@nestjs/mercurius';
import { BookingModule } from './booking/booking.module';
import { SettingsModule } from './settings/settings.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { UploadModule } from './upload/upload.module';
import { ReviewModule } from './review/review.module';
import * as redisStore from 'cache-manager-redis-store';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
    EventEmitterModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      store: redisStore as any,
      host: 'localhost',
      port: 6379,
      ttl: 60,
    }),

    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: 'schema.gql',
      graphiql: true,

      context: (req, reply) => ({
        req,
        reply,
      }),
    }),
    MongooseModule.forRoot('mongodb://127.0.0.1:27017/Hotelo?replicaSet=rs0'),
    ScheduleModule.forRoot(),

    CabinModule,
    UserModule,
    AuthModule,
    BookingModule,
    SettingsModule,
    UploadModule,
    ReviewModule,
  ],
})
export class AppModule {}
