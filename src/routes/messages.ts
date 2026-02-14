import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const dreamId = req.query.dream_id as string | undefined;
    const userId = req.user!.userId;

    if (!dreamId) {
      return res.status(400).json({ error: 'dream_id is required' });
    }

    const dream = await prisma.dream.findUnique({ where: { id: dreamId } });

    if (!dream) {
      return res.status(404).json({ error: 'Dream not found' });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const hasAccess =
      dream.dreamerId === userId ||
      dream.interpreterId === userId ||
      profile?.role === 'admin' ||
      profile?.role === 'super_admin';

    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if interpreter is assigned to the dream
    const isSuperAdmin = profile?.role === 'super_admin';
    if (!dream.interpreterId && !isSuperAdmin) {
      return res.status(403).json({
        error: 'Messages are not available yet. An interpreter must be assigned to this dream first.'
      });
    }

    const messages = await prisma.message.findMany({
      where: { dreamId },
      include: {
        sender: {
          select: {
            id: true,
            role: true, // Only role for anonymous display
            // Exclude: fullName, avatarUrl, email - all contact info hidden
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Return anonymous messages - replace sender info with generic labels
    const anonymousMessages = messages.map((msg) => ({
      ...msg,
      sender: {
        id: msg.sender.id,
        role: msg.sender.role,
        // Use generic labels instead of real names
        displayName: msg.sender.role === 'dreamer' ? 'الرائي' : 'المفسر',
        // No avatarUrl, fullName, or email exposed
      },
    }));

    return res.json(anonymousMessages);
  } catch (error) {
    console.error('[Messages] Fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { dream_id, content, audio } = req.body ?? {};

    if (!dream_id) {
      return res.status(400).json({ error: 'dream_id is required' });
    }

    if (!content && !audio) {
      return res.status(400).json({ error: 'Either content or audio is required' });
    }

    const dream = await prisma.dream.findUnique({
      where: { id: dream_id },
      select: {
        id: true,
        dreamerId: true,
        interpreterId: true,
      },
    });

    if (!dream) {
      return res.status(404).json({ error: 'Dream not found' });
    }

    if (!dream.interpreterId) {
      return res.status(403).json({
        error: 'Cannot send messages until an interpreter is assigned',
        code: 'NO_INTERPRETER_ASSIGNED',
      });
    }

    if (dream.dreamerId !== userId && dream.interpreterId !== userId) {
      return res.status(403).json({ error: 'You are not authorized to message this dream' });
    }

    let audioUrl: string | undefined;

    // Handle audio upload if provided
    if (audio && audio.startsWith('data:audio')) {
      const matches = audio.match(/^data:audio\/(\w+);base64,(.+)$/);
      if (matches) {
        const audioType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        const audioDir = join(__dirname, '../../public/uploads/audio');
        if (!existsSync(audioDir)) {
          mkdirSync(audioDir, { recursive: true });
        }

        const filename = `msg-${userId}-${Date.now()}.${audioType}`;
        const filepath = join(audioDir, filename);
        audioUrl = `/uploads/audio/${filename}`;

        await writeFile(filepath, buffer);
      }
    }

    const message = await prisma.message.create({
      data: {
        dreamId: dream_id,
        senderId: userId,
        content: content || '[رسالة صوتية]',
        messageType: audioUrl ? 'audio' : 'text',
        audioUrl,
      },
      include: {
        sender: {
          select: {
            id: true,
            role: true, // Only role for anonymous display
            // Exclude: fullName, avatarUrl, email - all contact info hidden
          },
        },
      },
    });

    // If dreamer replied "نعم" to the verification question, complete the request and dream (close chat)
    const contentTrimmed = (content || '').trim();
    if (
      contentTrimmed === 'نعم' &&
      dream.dreamerId === userId &&
      dream.interpreterId
    ) {
      const requestRow = await prisma.request.findFirst({
        where: {
          dreamId: dream_id,
          interpreterId: dream.interpreterId,
        },
        select: { id: true, pendingCompletionAt: true, status: true },
      });
      if (
        requestRow &&
        requestRow.pendingCompletionAt &&
        requestRow.status !== 'completed'
      ) {
        const now = new Date();
        await prisma.$transaction([
          prisma.request.update({
            where: { id: requestRow.id },
            data: {
              status: 'completed',
              completedAt: now,
              pendingCompletionAt: null,
            },
          }),
          prisma.dream.update({
            where: { id: dream_id },
            data: { status: 'interpreted' },
          }),
        ]);
      }
    }

    // Return anonymous message
    const anonymousMessage = {
      ...message,
      sender: {
        id: message.sender.id,
        role: message.sender.role,
        // Use generic labels instead of real names
        displayName: message.sender.role === 'dreamer' ? 'الرائي' : 'المفسر',
        // No avatarUrl, fullName, or email exposed
      },
    };

    // Broadcast to WebSocket room so other participant sees the message in real time
    const io = req.app.get('io');
    if (io) {
      io.to(`dream:${dream_id}`).emit('message:new', anonymousMessage);
    }

    return res.status(201).json(anonymousMessage);
  } catch (error) {
    console.error('[Messages] Create error:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

const MESSAGE_EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { content } = req.body ?? {};

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        sender: { select: { id: true, role: true } },
      },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Only the sender can edit this message' });
    }

    const createdAt = new Date(message.createdAt).getTime();
    if (Date.now() - createdAt > MESSAGE_EDIT_WINDOW_MS) {
      return res.status(400).json({
        error: 'Message can only be edited within 10 minutes of sending',
      });
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { content: content.trim() },
      include: {
        sender: { select: { id: true, role: true } },
      },
    });

    const anonymousMessage = {
      ...updated,
      sender: {
        id: updated.sender.id,
        role: updated.sender.role,
        displayName: updated.sender.role === 'dreamer' ? 'الرائي' : 'المفسر',
      },
    };

    const io = req.app.get('io');
    if (io && updated.dreamId) {
      io.to(`dream:${updated.dreamId}`).emit('message:updated', anonymousMessage);
    }

    return res.json(anonymousMessage);
  } catch (error) {
    console.error('[Messages] Update error:', error);
    return res.status(500).json({ error: 'Failed to update message' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const message = await prisma.message.findUnique({ where: { id } });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.message.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    console.error('[Messages] Delete error:', error);
    return res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;



