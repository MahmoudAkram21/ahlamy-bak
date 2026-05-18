import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { createNotification } from '../utils/notifications';
import { emitRequestChatMessage } from '../lib/chatEvents';
import { writeFile } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const router = Router();

function countLetters(content: string) {
  return Array.from(content || '').length;
}

async function saveAudioMessage(userId: string, audio: string) {
  if (!audio.startsWith('data:audio')) return null;

  const matches = audio.match(/^data:audio\/(\w+);base64,(.+)$/);
  if (!matches) return null;

  const audioType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const audioDir = join(__dirname, '../../public/uploads/audio');
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  const filename = `chat-${userId}-${Date.now()}.${audioType}`;
  const filepath = join(audioDir, filename);
  await writeFile(filepath, buffer);
  return `/uploads/audio/${filename}`;
}

router.get('/templates', requireAuth, async (req, res) => {
  try {
    const profile = await prisma.profile.findFirst({
      where: { id: req.user!.userId, deletedAt: null },
      select: { role: true },
    });

    if (!profile || !['interpreter', 'admin', 'super_admin'].includes(profile.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const templates = await prisma.interpreterMessageTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return res.json({ templates });
  } catch (error) {
    console.error('[Chat] Templates fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const requestId = req.query.request_id as string | undefined;

    if (!requestId) {
      return res.status(400).json({ error: 'request_id is required' });
    }

    const request = await prisma.request.findFirst({
      where: { id: requestId, dream: { deletedAt: null } },
      select: {
        dreamerId: true,
        interpreterId: true,
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findFirst({
      where: { id: req.user!.userId, deletedAt: null },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === 'super_admin';
    const isParticipant =
      request.dreamerId === req.user!.userId || request.interpreterId === req.user!.userId;

    if (!isParticipant && !isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Dreamers can see their own initial paid message before assignment.
    if (!request.interpreterId && !isSuperAdmin && request.dreamerId !== req.user!.userId) {
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
    const { request_id, content, message_type, audio, audioDuration } = req.body ?? {};
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    const hasAudio = typeof audio === 'string' && audio.startsWith('data:audio');

    if (!request_id || (!normalizedContent && !hasAudio)) {
      return res.status(400).json({ error: 'request_id and content or audio are required' });
    }

    const request = await prisma.request.findFirst({
      where: { id: request_id, dream: { deletedAt: null } },
      select: {
        id: true,
        dreamerId: true,
        interpreterId: true,
        status: true,
        plan: {
          select: {
            letterQuota: true,
            supportsVoiceNotes: true,
            voiceNoteMaxSeconds: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
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

    if (request.status === 'closed') {
      return res.status(409).json({ error: 'Request is closed' });
    }

    const isDreamer = request.dreamerId === userId;
    const isInterpreter = request.interpreterId === userId;
    const existingMessageCount = await prisma.chatMessage.count({ where: { requestId: request_id } });
    let audioUrl: string | null = null;
    let nextMessageType = message_type || 'text';

    if (hasAudio) {
      if (isDreamer) {
        const maxSeconds = request.plan?.voiceNoteMaxSeconds;
        const durationSeconds = Number(audioDuration || 0);

        if (existingMessageCount > 0) {
          return res.status(400).json({ error: 'Dreamers can only send a voice note as the first message' });
        }

        if (!request.plan?.supportsVoiceNotes || !maxSeconds) {
          return res.status(400).json({ error: 'This plan does not support voice notes' });
        }

        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxSeconds) {
          return res.status(400).json({ error: `Voice note must be ${maxSeconds} seconds or less` });
        }
      } else if (!isInterpreter && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only participants can send voice notes' });
      }

      audioUrl = await saveAudioMessage(userId, audio);
      if (!audioUrl) {
        return res.status(400).json({ error: 'Invalid audio data' });
      }
      nextMessageType = 'audio';
    }

    if (isDreamer && !hasAudio && existingMessageCount === 0) {
      const letterQuota = request.plan?.letterQuota;
      if (letterQuota && countLetters(normalizedContent) > letterQuota) {
        return res.status(400).json({ error: `Message exceeds plan letter quota of ${letterQuota}` });
      }
    }

    const message = await prisma.chatMessage.create({
      data: {
        requestId: request_id,
        senderId: userId,
        content: normalizedContent || null,
        messageType: nextMessageType,
        audioUrl,
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

    emitRequestChatMessage(request_id, message);

    if (request.interpreterId && userId === request.dreamerId) {
      createNotification(
        request.interpreterId,
        'request_message',
        'The dreamer has replied to your response',
        message.id
      ).catch((error) => console.error('[Notifications] Dreamer reply trigger error:', error));
    } else if (userId === request.interpreterId) {
      createNotification(
        request.dreamerId,
        'request_message',
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

router.patch('/messages/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const message = await prisma.chatMessage.findUnique({
      where: { id: req.params.id },
      include: {
        request: {
          select: {
            status: true,
            dream: { select: { deletedAt: true } },
          },
        },
      },
    });

    if (!message || message.request.dream.deletedAt) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.senderId !== userId || message.messageType === 'audio') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (message.request.status === 'closed') {
      return res.status(409).json({ error: 'Request is closed' });
    }

    const updated = await prisma.chatMessage.update({
      where: { id: message.id },
      data: { content },
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

    emitRequestChatMessage(updated.requestId, updated);
    return res.json(updated);
  } catch (error) {
    console.error('[Chat] Message edit error:', error);
    return res.status(500).json({ error: 'Failed to edit message' });
  }
});

export default router;



