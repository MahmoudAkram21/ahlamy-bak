import type { PrismaClient } from '@prisma/client';

/**
 * If the request has pendingCompletionAt in the past and is not completed,
 * mark it completed and the linked dream as interpreted. Idempotent.
 * Returns false on any error so callers can continue without failing.
 */
export async function applyPendingCompletionIfDue(
  prisma: PrismaClient,
  requestId: string
): Promise<boolean> {
  try {
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        dreamId: true,
        status: true,
        pendingCompletionAt: true,
      },
    });

    if (
      !request ||
      !request.pendingCompletionAt ||
      request.status === 'completed'
    ) {
      return false;
    }

    const now = new Date();
    if (now < request.pendingCompletionAt) {
      return false;
    }

    await prisma.$transaction([
      prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          completedAt: now,
          pendingCompletionAt: null,
        },
      }),
      prisma.dream.update({
        where: { id: request.dreamId },
        data: { status: 'interpreted' },
      }),
    ]);

    return true;
  } catch (err) {
    console.error('[requestCompletion] applyPendingCompletionIfDue error:', err);
    return false;
  }
}
