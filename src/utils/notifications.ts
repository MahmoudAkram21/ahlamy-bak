import type { PrismaClient } from '@prisma/client';
import type { NotificationType } from '@prisma/client';

export interface CreateNotificationParams {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityId?: string | null;
  entityType?: string | null;
}

/**
 * Create an in-app notification for a user (e.g. dreamer or interpreter).
 * recipientId is the User id (same as Profile id in this app).
 */
export async function createNotification(
  prisma: PrismaClient,
  params: CreateNotificationParams
) {
  const { recipientId, type, title, message, entityId, entityType } = params;
  await prisma.notification.create({
    data: {
      recipientId,
      type,
      title,
      message,
      entityId: entityId ?? undefined,
      entityType: entityType ?? undefined,
    },
  });
}
