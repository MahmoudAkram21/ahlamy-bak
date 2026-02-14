import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/notifications
 * Get all notifications for the current user (paginated).
 * Query: limit (default 20), offset (default 0), unreadOnly (default false)
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const unreadOnly = req.query.unreadOnly === 'true';

    const where = {
      recipientId: userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { recipientId: userId, isRead: false },
      }),
    ]);

    return res.json({
      notifications,
      total,
      unreadCount,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Notifications] List error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get only the unread notifications count (lightweight).
 */
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const count = await prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });
    return res.json({ unreadCount: count });
  } catch (error) {
    console.error('[Notifications] Unread count error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications for the current user as read.
 * (Defined before /:id/read so "read-all" is not captured as id.)
 */
router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const result = await prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true },
    });

    return res.json({ ok: true, updatedCount: result.count });
  } catch (error) {
    console.error('[Notifications] Mark all read error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read (must belong to the user).
 */
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findFirst({
      where: { id, recipientId: userId },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.json({ ok: true, id });
  } catch (error) {
    console.error('[Notifications] Mark read error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
