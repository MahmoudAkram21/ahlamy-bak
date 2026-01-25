import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../utils/auth';

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

    const [totalUsers, totalRequests, completedRequests, totalPlans, totalRevenueAggregate] = await Promise.all([
      prisma.profile.count(),
      prisma.request.count(),
      prisma.request.count({ where: { status: 'completed' } }),
      prisma.plan.count(),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'succeeded' },
      }),
    ]);

    const totalRevenue = totalRevenueAggregate._sum.amount
      ? Number(totalRevenueAggregate._sum.amount)
      : 0;

    const stats = {
      totalUsers,
      totalRequests,
      completedRequests,
      totalPlans,
      totalRevenue,
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
      updateData.rating = new Prisma.Decimal(parsedRating);
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

export default router;



