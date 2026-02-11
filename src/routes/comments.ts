import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const dreamId = req.query.dream_id as string | undefined;
    const approvedOnly = req.query.approved === 'true';

    // Public: get approved comments only (e.g. for homepage "اراء عملاء احلامي")
    if (approvedOnly) {
      const comments = await prisma.comment.findMany({
        where: { isApproved: true },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return res.json(comments);
    }

    if (!dreamId) {
      return res.status(400).json({ error: 'dream_id is required' });
    }

    const comments = await prisma.comment.findMany({
      where: { dreamId },
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



