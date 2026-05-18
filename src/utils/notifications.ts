import type { NotificationType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";

export async function createNotification(
  userId: string,
  type: NotificationType,
  message: string,
  referenceId?: string | null,
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  return tx.notification.create({
    data: {
      userId,
      type,
      message,
      referenceId: referenceId || null,
    },
  });
}

export async function createNotificationsForAdmins(
  type: NotificationType,
  message: string,
  referenceId?: string | null,
  excludeUserId?: string | null
) {
  const admins = await prisma.profile.findMany({
    where: {
      role: { in: ["admin", "super_admin"] },
      deletedAt: null,
      id: excludeUserId ? { not: excludeUserId } : undefined,
    },
    select: { id: true },
  });

  if (admins.length === 0) {
    return { count: 0 };
  }

  return prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type,
      message,
      referenceId: referenceId || null,
    })),
    skipDuplicates: false,
  });
}
