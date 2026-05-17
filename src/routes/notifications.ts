import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({
      notifications: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        message: notification.message,
        isRead: notification.isRead,
        referenceId: notification.referenceId,
        createdAt: notification.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[Notifications] Fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/count', requireAuth, async (req, res) => {
  try {
    const unreadCount = await prisma.notification.count({
      where: {
        userId: req.user!.userId,
        isRead: false,
      },
    });

    return res.json({ unreadCount });
  } catch (error) {
    console.error('[Notifications] Count error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/read-all', requireAuth, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId: req.user!.userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    return res.json({ updatedCount: result.count });
  } catch (error) {
    console.error('[Notifications] Read all error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        id: req.params.id,
        userId: req.user!.userId,
      },
      data: {
        isRead: true,
      },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[Notifications] Read error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



