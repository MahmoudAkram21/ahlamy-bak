import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../utils/auth.js';
import { buildAdminVisionStatsPdf } from '../utils/pdf-vision-stats.js';

const router = Router();

async function ensureRole(userId: string, roles: Array<'admin' | 'super_admin'>) {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!profile) {
    return false;
  }

  return roles.includes(profile.role as 'admin' | 'super_admin');
}

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const isSuperAdmin = await ensureRole(userId, ['super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const [
      totalUsers,
      completedRequests,
      totalPlans,
      totalRevenueAggregate,
      dreamsRaw,
    ] = await Promise.all([
      prisma.profile.count(),
      prisma.request.count({ where: { status: 'completed' } }),
      prisma.plan.count(),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'succeeded' },
      }),
      prisma.dream.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    const totalRevenue = totalRevenueAggregate._sum.amount
      ? Number(totalRevenueAggregate._sum.amount)
      : 0;

    const totalRequests = await prisma.request.count();
    const dreamsByStatus = dreamsRaw.reduce(
      (acc, row) => {
        acc[row.status] = row._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );
    const totalDreams =
      dreamsRaw.reduce((sum, row) => sum + row._count.id, 0);

    const stats = {
      totalUsers,
      totalRequests,
      completedRequests,
      totalPlans,
      totalRevenue,
      totalDreams,
      dreams: {
        new: dreamsByStatus.new ?? 0,
        pending_payment: dreamsByStatus.pending_payment ?? 0,
        pending_inquiry: dreamsByStatus.pending_inquiry ?? 0,
        pending_interpretation: dreamsByStatus.pending_interpretation ?? 0,
        interpreted: dreamsByStatus.interpreted ?? 0,
        returned: dreamsByStatus.returned ?? 0,
      },
    };

    return res.json({ stats });
  } catch (error) {
    console.error('[Admin] Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

router.get('/users', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const isSuperAdmin = await ensureRole(userId, ['super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const users = await prisma.profile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isAvailable: true,
        totalInterpretations: true,
        rating: true,
        createdAt: true,
      },
    });

    const formattedUsers = users.map((user) => ({
      ...user,
      rating: user.rating.toString(),
      isAdmin: user.role === 'admin' || user.role === 'super_admin',
      isSuperAdmin: user.role === 'super_admin',
    }));

    return res.json({ users: formattedUsers });
  } catch (error) {
    console.error('[Admin] Users error:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/make-super-admin', requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;
    const { userId } = req.body ?? {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const isElevated = await ensureRole(requesterId, ['super_admin']);

    if (!isElevated) {
      return res.status(403).json({ error: 'Forbidden - Super admin access required' });
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: userId },
      data: {
        role: 'super_admin',
      },
    });

    return res.json({ profile: updatedProfile });
  } catch (error) {
    console.error('[Admin] Make super admin error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/users', requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;
    const { email, password, fullName, role = 'dreamer', isAvailable = true } = req.body ?? {};

    const isSuperAdmin = await ensureRole(requesterId, ['super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin access required' });
    }

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const allowedRoles = ['dreamer', 'interpreter', 'admin', 'super_admin'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role value' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user and profile in transaction
    const { user, profile } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
        },
      });

      const createdProfile = await tx.profile.create({
        data: {
          id: createdUser.id,
          email: createdUser.email,
          fullName: fullName || null,
          role,
          isAvailable: typeof isAvailable === 'boolean' ? isAvailable : true,
        },
      });

      return { user: createdUser, profile: createdProfile };
    });

    console.log(`[Admin] Created user: ${email} with role: ${role}`);

    return res.status(201).json({
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        isAvailable: profile.isAvailable,
        totalInterpretations: profile.totalInterpretations,
        rating: profile.rating.toString(),
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        isSuperAdmin: profile.role === 'super_admin',
        createdAt: profile.createdAt,
      },
    });
  } catch (error) {
    console.error('[Admin] Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/users/:id', requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;
    const targetId = req.params.id;
    const { fullName, role, isAvailable, totalInterpretations, rating } = req.body ?? {};

    const isSuperAdmin = await ensureRole(requesterId, ['super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin access required' });
    }

    const existingProfile = await prisma.profile.findUnique({
      where: { id: targetId },
    });

    if (!existingProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) {
      if (fullName !== null && typeof fullName !== 'string') {
        return res.status(400).json({ error: 'fullName must be a string or null' });
      }
      updateData.fullName = fullName;
    }

    if (role !== undefined) {
      const allowedRoles = ['dreamer', 'interpreter', 'admin', 'super_admin'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role value' });
      }
      updateData.role = role;
    }

    if (isAvailable !== undefined) {
      if (typeof isAvailable !== 'boolean') {
        return res.status(400).json({ error: 'isAvailable must be boolean' });
      }
      updateData.isAvailable = isAvailable;
    }

    if (totalInterpretations !== undefined) {
      const parsedTotal = Number(totalInterpretations);
      if (Number.isNaN(parsedTotal) || parsedTotal < 0) {
        return res.status(400).json({ error: 'totalInterpretations must be a non-negative number' });
      }
      updateData.totalInterpretations = Math.floor(parsedTotal);
    }

    if (rating !== undefined) {
      const parsedRating = Number(rating);
      if (Number.isNaN(parsedRating) || parsedRating < 0) {
        return res.status(400).json({ error: 'rating must be a positive number' });
      }
      updateData.rating = parsedRating;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: targetId },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isAvailable: true,
        totalInterpretations: true,
        rating: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      profile: {
        ...updatedProfile,
        rating: updatedProfile.rating.toString(),
        isAdmin: updatedProfile.role === 'admin' || updatedProfile.role === 'super_admin',
        isSuperAdmin: updatedProfile.role === 'super_admin',
      },
    });
  } catch (error) {
    console.error('[Admin] Update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;
    const targetId = req.params.id;

    const isSuperAdmin = await ensureRole(requesterId, ['super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin access required' });
    }

    // Prevent self-deletion
    if (requesterId === targetId) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: targetId },
      include: { profile: true },
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (cascade will delete profile and related records)
    await prisma.user.delete({
      where: { id: targetId },
    });

    console.log(`[Admin] Deleted user: ${existingUser.email}`);

    return res.json({
      message: 'User deleted successfully',
      deletedUser: {
        id: targetId,
        email: existingUser.email,
      },
    });
  } catch (error) {
    console.error('[Admin] Delete user error:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.get('/interpreters', requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;

    const hasAccess = await ensureRole(requesterId, ['admin', 'super_admin']);

    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const interpreters = await prisma.profile.findMany({
      where: { role: 'interpreter' },
      orderBy: [
        { isAvailable: 'desc' },
        { totalInterpretations: 'desc' },
      ],
      select: {
        id: true,
        fullName: true,
        email: true,
        isAvailable: true,
        totalInterpretations: true,
        rating: true,
      },
    });

    const formatted = interpreters.map((interpreter) => ({
      ...interpreter,
      rating: interpreter.rating.toString(),
    }));

    return res.json({ interpreters: formatted });
  } catch (error) {
    console.error('[Admin] Interpreters fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch interpreters' });
  }
});

const VISION_TYPES = ['gold_sa', 'silver_sa', 'bronze_sa', 'gold_eg', 'silver_eg', 'bronze_eg'] as const;

function getMonthRange(monthParam?: string): { start: Date; end: Date } {
  const now = new Date();
  let start: Date;
  let end: Date;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 0, 23, 59, 59, 999);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date();
  }
  return { start, end };
}

router.get('/interpreters/stats-by-type', requireAuth, async (req, res) => {
  try {
    const hasAccess = await ensureRole(req.user!.userId, ['super_admin']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden - Super admin only' });
    }
    const month = req.query.month as string | undefined;
    const { start, end } = getMonthRange(month);

    const completed = await prisma.request.findMany({
      where: {
        status: 'completed',
        completedAt: { gte: start, lte: end },
        interpreterId: { not: null },
      },
      select: {
        interpreterId: true,
        dream: {
          select: { visionType: true },
        },
      },
    });

    const byInterpreter: Record<string, { fullName: string; email: string; counts: Record<string, number>; total: number }> = {};
    const interpreterIds = [...new Set(completed.map((r) => r.interpreterId).filter(Boolean))] as string[];
    if (interpreterIds.length > 0) {
      const profiles = await prisma.profile.findMany({
        where: { id: { in: interpreterIds } },
        select: { id: true, fullName: true, email: true },
      });
      for (const p of profiles) {
        byInterpreter[p.id] = {
          fullName: p.fullName || '',
          email: p.email,
          counts: Object.fromEntries(VISION_TYPES.map((t) => [t, 0])),
          total: 0,
        };
      }
    }
    for (const r of completed) {
      const iid = r.interpreterId!;
      if (!byInterpreter[iid]) continue;
      const vt = r.dream?.visionType && VISION_TYPES.includes(r.dream.visionType as any) ? r.dream.visionType : 'other';
      if (vt !== 'other') {
        byInterpreter[iid].counts[vt] = (byInterpreter[iid].counts[vt] || 0) + 1;
      }
      byInterpreter[iid].total += 1;
    }

    const list = Object.entries(byInterpreter).map(([interpreterId, data]) => ({
      interpreterId,
      ...data,
    }));

    return res.json({ month: month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, start, end, stats: list });
  } catch (error) {
    console.error('[Admin] Stats by type error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/interpreters/stats-by-type/export', requireAuth, async (req, res) => {
  try {
    const hasAccess = await ensureRole(req.user!.userId, ['super_admin']);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Forbidden - Super admin only' });
    }
    const month = req.query.month as string | undefined;
    const format = (req.query.format as string) || 'json';
    const { start, end } = getMonthRange(month);

    const completed = await prisma.request.findMany({
      where: {
        status: 'completed',
        completedAt: { gte: start, lte: end },
        interpreterId: { not: null },
      },
      select: {
        interpreterId: true,
        dream: { select: { visionType: true } },
      },
    });

    const byInterpreter: Record<string, { fullName: string; email: string; counts: Record<string, number>; total: number }> = {};
    const interpreterIds = [...new Set(completed.map((r) => r.interpreterId).filter(Boolean))] as string[];
    if (interpreterIds.length > 0) {
      const profiles = await prisma.profile.findMany({
        where: { id: { in: interpreterIds } },
        select: { id: true, fullName: true, email: true },
      });
      for (const p of profiles) {
        byInterpreter[p.id] = {
          fullName: p.fullName || '',
          email: p.email,
          counts: Object.fromEntries(VISION_TYPES.map((t) => [t, 0])),
          total: 0,
        };
      }
    }
    for (const r of completed) {
      const iid = r.interpreterId!;
      if (!byInterpreter[iid]) continue;
      const vt = r.dream?.visionType && VISION_TYPES.includes(r.dream.visionType as any) ? r.dream.visionType : 'other';
      if (vt !== 'other') {
        byInterpreter[iid].counts[vt] = (byInterpreter[iid].counts[vt] || 0) + 1;
      }
      byInterpreter[iid].total += 1;
    }

    const list = Object.entries(byInterpreter).map(([interpreterId, data]) => ({ interpreterId, ...data }));
    const labels: Record<string, string> = {
      gold_sa: 'ذهبي سعودي',
      silver_sa: 'فضي سعودي',
      bronze_sa: 'برونزي سعودي',
      gold_eg: 'ذهبي مصري',
      silver_eg: 'فضي مصري',
      bronze_eg: 'برونزي مصري',
    };

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.json"`);
      return res.json({ month: month || 'current', start, end, stats: list, labels });
    }
    if (format === 'txt' || format === 'doc') {
      let body = `إحصائيات الرؤى حسب النوع\nالفترة: ${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}\n\n`;
      for (const data of list) {
        body += `${data.fullName || data.email}\n`;
        for (const t of VISION_TYPES) {
          body += `  ${labels[t]}: ${data.counts[t] || 0}\n`;
        }
        body += `  الإجمالي: ${data.total}\n\n`;
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.txt"`);
      return res.send(Buffer.from(body, 'utf-8'));
    }
    if (format === 'pdf') {
      const dateRange = `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}`;
      const pdfRows = list.map((d) => ({
        fullName: d.fullName || '',
        email: d.email,
        counts: d.counts,
        total: d.total,
      }));
      const pdfBuffer = await buildAdminVisionStatsPdf({
        dateRange,
        monthLabel: month || 'current',
        rows: pdfRows,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.pdf"`);
      return res.send(pdfBuffer);
    }
    return res.status(400).json({ error: 'Unsupported format. Use json, txt, doc, or pdf' });
  } catch (error) {
    console.error('[Admin] Export stats error:', error);
    return res.status(500).json({ error: 'Failed to export' });
  }
});

// --- Super admin: manage comment visibility (approve / hide for "اراء عملاء احلامي") ---
router.get('/comments', requireAuth, async (req, res) => {
  try {
    const isSuperAdmin = await ensureRole(req.user!.userId, ['super_admin']);
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin only' });
    }
    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, fullName: true, email: true },
        },
        dream: {
          select: { id: true, title: true },
        },
      },
    });
    return res.json({ comments });
  } catch (error) {
    console.error('[Admin] Comments list error:', error);
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

router.patch('/comments/:id', requireAuth, async (req, res) => {
  try {
    const isSuperAdmin = await ensureRole(req.user!.userId, ['super_admin']);
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin only' });
    }
    const { id } = req.params;
    const { isApproved } = req.body ?? {};
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ error: 'isApproved (boolean) required' });
    }
    const comment = await prisma.comment.update({
      where: { id },
      data: { isApproved },
    });
    return res.json(comment);
  } catch (error) {
    console.error('[Admin] Comment update error:', error);
    return res.status(500).json({ error: 'Failed to update comment' });
  }
});

export default router;



