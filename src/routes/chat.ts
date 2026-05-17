import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { createNotification } from '../utils/notifications';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const requestId = req.query.request_id as string | undefined;

    if (!requestId) {
      return res.status(400).json({ error: 'request_id is required' });
    }

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      select: {
        dreamerId: true,
        interpreterId: true,
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: req.user!.userId },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === 'super_admin';
    const isParticipant =
      request.dreamerId === req.user!.userId || request.interpreterId === req.user!.userId;

    if (!isParticipant && !isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if interpreter is assigned
    if (!request.interpreterId && !isSuperAdmin) {
      return res.status(403).json({
        error: 'Chat is not available yet. An interpreter must be assigned to this request first.'
      });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { requestId },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.json(messages);
  } catch (error) {
    console.error('[Chat] Fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { request_id, content, message_type } = req.body ?? {};

    if (!request_id || !content) {
      return res.status(400).json({ error: 'request_id and content are required' });
    }

    const request = await prisma.request.findUnique({
      where: { id: request_id },
      select: {
        dreamerId: true,
        interpreterId: true,
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === 'super_admin';
    const isParticipant =
      request.dreamerId === userId || request.interpreterId === userId;

    if (!isParticipant && !isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // NEW: Check if interpreter is assigned before allowing chat
    if (!request.interpreterId && !isSuperAdmin) {
      return res.status(403).json({
        error: 'Chat is not available yet. An interpreter must be assigned to this request first.'
      });
    }

    const message = await prisma.chatMessage.create({
      data: {
        requestId: request_id,
        senderId: userId,
        content,
        messageType: message_type || 'text',
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
      },
    });

    if (request.interpreterId && userId === request.dreamerId) {
      createNotification(
        request.interpreterId,
        'dream_message',
        'The dreamer has replied to your response',
        message.id
      ).catch((error) => console.error('[Notifications] Dreamer reply trigger error:', error));
    } else if (userId === request.interpreterId) {
      createNotification(
        request.dreamerId,
        'dream_message',
        'An interpreter has responded to your dream',
        message.id
      ).catch((error) => console.error('[Notifications] Interpreter response trigger error:', error));
    }

    return res.json(message);
  } catch (error) {
    console.error('[Chat] Create error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



