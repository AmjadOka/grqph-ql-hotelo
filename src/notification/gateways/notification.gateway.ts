import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Notification } from '../notification.schema';

@WebSocketGateway({
  cors: { origin: process.env.CLIENT_URL, credentials: true },
  namespace: 'notifications',
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /* ─────────────────────────────────────────────────────
     LIFECYCLE
  ───────────────────────────────────────────────────── */

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers?.authorization as string)?.split(' ')[1];

      if (!token) throw new Error('No token');

      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        type: string;
      }>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      if (payload.type !== 'access') throw new Error('Wrong token type');

      client.join(`user:${payload.sub}`);
      client.data.userId = payload.sub;

      this.logger.log(`Connected: ${payload.sub}`);
    } catch {
      // Invalid or missing token — refuse the connection
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Disconnected: ${client.data?.userId ?? client.id}`);
  }

  /* ─────────────────────────────────────────────────────
     SERVER → CLIENT
  ───────────────────────────────────────────────────── */

  /**
   * FIX: was missing — InAppProcessor calls this after saving to MongoDB.
   * Emits the notification to the target user's private room only.
   */
  pushToUser(userId: string, notification: Notification): void {
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  /* ─────────────────────────────────────────────────────
     CLIENT → SERVER
  ───────────────────────────────────────────────────── */

  @SubscribeMessage('mark-read')
  handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() notificationId: string,
  ): void {
    if (!client.data.userId) return;

    // Ack back — actual DB update goes through the GraphQL mutation
    client.emit('mark-read-ack', { id: notificationId, ok: true });
  }
}
