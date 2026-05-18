import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const dreamId = req.query.dream_id as string | undefined;

    if (!dreamId) {
      return res.status(400).json({ error: 'dream_id is required' });
    }

    const comments = await prisma.comment.findMany({
      where: { dreamId, dream: { deletedAt: null } },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(comments);
  } catch (error) {
    console.error('[Comments] Fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { dream_id, content } = req.body ?? {};

    if (!dream_id || !content) {
      return res.status(400).json({ error: 'dream_id and content are required' });
    }

    const dream = await prisma.dream.findFirst({
      where: { id: dream_id, deletedAt: null },
      select: { id: true },
    });

    if (!dream) {
      return res.status(404).json({ error: 'Dream not found' });
    }

    const comment = await prisma.comment.create({
      data: {
        dreamId: dream_id,
        userId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
    });

    return res.status(201).json(comment);
  } catch (error) {
    console.error('[Comments] Create error:', error);
    return res.status(500).json({ error: 'Failed to create comment' });
  }
});

export default router;



