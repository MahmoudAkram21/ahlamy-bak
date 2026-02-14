import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { createNotification } from '../utils/notifications.js';
import { applyPendingCompletionIfDue } from '../utils/requestCompletion.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

    let requests = await prisma.request.findMany({
      where: isAdmin
        ? {}
        : {
            OR: [{ dreamerId: userId }, { interpreterId: userId }],
          },
      include: {
        dream: {
          select: {
            id: true,
            title: true,
            content: true,
            status: true,
          },
        },
        dreamer: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
        interpreter: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Apply 10-minute auto-completion for any request whose deadline passed
    let appliedAny = false;
    for (const r of requests) {
      if (await applyPendingCompletionIfDue(prisma, r.id)) appliedAny = true;
    }
    if (appliedAny) {
      requests = await prisma.request.findMany({
        where: isAdmin
          ? {}
          : {
              OR: [{ dreamerId: userId }, { interpreterId: userId }],
            },
        include: {
          dream: {
            select: {
              id: true,
              title: true,
              content: true,
              status: true,
            },
          },
          dreamer: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
            },
          },
          interpreter: {
            select: {
              id: true,
              fullName: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return res.json(requests);
  } catch (error) {
    console.error('[Requests] Fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { dream_id, title, description, budget } = req.body ?? {};

    if (!dream_id || !title) {
      return res.status(400).json({ error: 'dream_id and title are required' });
    }

    const newRequest = await prisma.request.create({
      data: {
        dreamId: dream_id,
        dreamerId: userId,
        title,
        description,
        budget: budget ? parseFloat(budget) : null,
        status: 'open',
      },
      include: {
        dream: {
          select: {
            id: true,
            title: true,
            content: true,
            status: true,
          },
        },
        dreamer: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return res.json(newRequest);
  } catch (error) {
    console.error('[Requests] Create error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const requestData = await prisma.request.findUnique({
      where: { id },
      include: {
        dream: true,
        dreamer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        interpreter: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!requestData) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

    const hasAccess =
      isAdmin ||
      requestData.dreamerId === userId ||
      requestData.interpreterId === userId;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(requestData);
  } catch (error) {
    console.error('[Requests] Fetch single error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const requesterId = req.user!.userId;
    const { status, interpreterId } = req.body ?? {};

    const existingRequest = await prisma.request.findUnique({
      where: { id },
      select: {
        dreamerId: true,
        interpreterId: true,
        dreamId: true,
      },
    });

    if (!existingRequest) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: requesterId },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === 'super_admin';
    const isAdmin = role === 'admin';
    const isDreamer = existingRequest.dreamerId === requesterId;
    const isInterpreter = existingRequest.interpreterId === requesterId;

    if (!isSuperAdmin && !isAdmin && !isDreamer && !isInterpreter) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (interpreterId) {
      if (!isAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: 'Only admins can assign interpreters' });
      }
    }

    if (status && !isSuperAdmin && !isDreamer && !isInterpreter) {
      return res.status(403).json({ error: 'Only the dreamer, assigned interpreter, or super admin can update status' });
    }

    const updateData: Record<string, unknown> = {};
    if (status) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.completedAt = new Date();
      }
    }
    if (interpreterId) updateData.interpreterId = interpreterId;
    if (interpreterId !== undefined && interpreterId !== null && !status) {
      updateData.status = 'in_progress';
    }
    // When interpreter returns, clear request's interpreter so admin can reassign
    if (status === 'returned' && isInterpreter) {
      updateData.interpreterId = null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    // When interpreter returns the vision: sync Dream (returned, unassign) so admin can redistribute
    if (status === 'returned' && isInterpreter) {
      await prisma.dream.update({
        where: { id: existingRequest.dreamId },
        data: {
          status: 'returned',
          interpreterId: null,
        },
      });
    }

    // When request is marked completed by interpreter: increment totalInterpretations only if
    // the dream was not already marked interpreted (avoid double count with dream page flow)
    if (status === 'completed' && existingRequest.interpreterId) {
      const dreamRow = await prisma.dream.findUnique({
        where: { id: existingRequest.dreamId },
        select: { status: true },
      });
      if (!dreamRow || dreamRow.status !== 'interpreted') {
        await prisma.profile.update({
          where: { id: existingRequest.interpreterId },
          data: { totalInterpretations: { increment: 1 } },
        });
      }
    }

    const updatedRequest = await prisma.request.update({
      where: { id },
      data: updateData,
      include: {
        dream: true,
        dreamer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        interpreter: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    // Notify dreamer when an interpreter is assigned to their request
    if (interpreterId && existingRequest.dreamerId) {
      await createNotification(prisma, {
        recipientId: existingRequest.dreamerId,
        type: 'SYSTEM',
        title: 'تم تعيين مفسر',
        message: 'تم تعيين مفسر لطلب تفسير رؤيتك. يمكنك متابعة المحادثة من صفحة الطلبات.',
        entityId: id,
        entityType: 'REQUEST',
      });
    }

    // Notify dreamer when the request is marked completed
    if (status === 'completed' && existingRequest.dreamerId) {
      await createNotification(prisma, {
        recipientId: existingRequest.dreamerId,
        type: 'SYSTEM',
        title: 'تم إكمال التفسير',
        message: 'تم إكمال تفسير رؤيتك. يمكنك مراجعة النتيجة من لوحة التحكم.',
        entityId: id,
        entityType: 'REQUEST',
      });
    }

    return res.json(updatedRequest);
  } catch (error) {
    console.error('[Requests] Update error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



