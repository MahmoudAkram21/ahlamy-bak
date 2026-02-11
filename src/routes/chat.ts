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
        pendingCompletionAt: true,
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

    // If dreamer replies, cancel the 10-minute auto-completion (interpreter had requested completion)
    if (request.pendingCompletionAt && request.dreamerId === userId) {
      await prisma.request.update({
        where: { id: request_id },
        data: { pendingCompletionAt: null },
      });
    }

    // Notify the other participant (dreamer or interpreter)
    const recipientId =
      userId === request.dreamerId ? request.interpreterId : request.dreamerId;
    const senderName = message.sender?.fullName || 'شخص';
    if (recipientId) {
      await createNotification(prisma, {
        recipientId,
        type: 'COMMENT',
        title: 'رسالة جديدة',
        message: `لديك رسالة جديدة من ${senderName} في محادثة تفسير الرؤية.`,
        entityId: request_id,
        entityType: 'REQUEST',
      });
    }

    return res.json(message);
  } catch (error) {
    console.error('[Chat] Create error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

router.patch('/messages/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { id: messageId } = req.params;
    const { content } = req.body ?? {};

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        request: {
          select: {
            dreamerId: true,
            interpreterId: true,
          },
        },
      },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Only the sender can edit this message' });
    }

    const request = message.request;
    const isParticipant =
      request.dreamerId === userId || request.interpreterId === userId;
    if (!isParticipant) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const createdAt = new Date(message.createdAt);
    const canEditUntil = new Date(createdAt.getTime() + EDIT_WINDOW_MS);
    if (now > canEditUntil) {
      return res.status(403).json({ error: 'Edit window has ended (10 minutes)' });
    }

    const updated = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content: content.trim(),
        editedAt: now,
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

    return res.json(updated);
  } catch (error) {
    console.error('[Chat] PATCH message error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



