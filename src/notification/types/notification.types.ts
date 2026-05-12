import { NotificationType } from '../notification.schema';

export const NOTIFICATION_QUEUE = 'notifications';

export const NotificationJobs = {
  EMAIL: 'send-email',
  IN_APP: 'save-in-app',
} as const;

// ─── Base ─────────────────────────────────────────────────────────────────────

interface BaseNotificationPayload {
  userId: string;
  type: NotificationType;
}

// ─── Email job ────────────────────────────────────────────────────────────────

export interface EmailJobPayload extends BaseNotificationPayload {
  to: string; // recipient email address
  subject: string;
  templateId: string; // maps to an HTML template file
  templateData: Record<string, unknown>;
}

// ─── In-app job ───────────────────────────────────────────────────────────────

export interface InAppJobPayload extends BaseNotificationPayload {
  title: string;
  body: string;
  link?: string;
}
