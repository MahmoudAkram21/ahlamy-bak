import { Router } from 'express';
import prisma from '../lib/prisma';
import { hashPassword, verifyPassword, generateToken } from '../utils/auth';
import { setSessionCookie, clearSessionCookie } from '../utils/session';
import { requireAuth } from '../middleware/auth';

const router = Router();

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const ALLOWED_SELF_SERVICE_ROLES = new Set(['dreamer', 'interpreter']);

router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName, role = 'dreamer' } = req.body ?? {};

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    if (!ALLOWED_SELF_SERVICE_ROLES.has(role)) {
      return res.status(403).json({ error: 'You are not allowed to register with this role' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await hashPassword(password);

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
          fullName,
          role,
        },
      });

      // Note: Trial plans are no longer supported in the new per-dream model
      // Users will purchase plans per dream instead

      return { user: createdUser, profile: createdProfile };
    });

    const token = generateToken({ userId: user.id, email: user.email, role: profile.role });
    setSessionCookie(res, token);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        role: profile.role,
      },
      profile: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        isAvailable: profile.isAvailable,
        totalInterpretations: profile.totalInterpretations,
        rating: profile.rating.toString(),
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        isSuperAdmin: profile.role === 'super_admin',
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Auth] Register error:', error);
    return res.status(500).json({ error: 'Failed to register user' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user || !user.profile) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ userId: user.id, email: user.email, role: user.profile.role });
    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.profile.role,
      },
      profile: {
        id: user.profile.id,
        email: user.profile.email,
        fullName: user.profile.fullName,
        role: user.profile.role,
        avatarUrl: user.profile.avatarUrl,
        bio: user.profile.bio,
        isAvailable: user.profile.isAvailable,
        totalInterpretations: user.profile.totalInterpretations,
        rating: user.profile.rating.toString(),
        isAdmin: user.profile.role === 'admin' || user.profile.role === 'super_admin',
        isSuperAdmin: user.profile.role === 'super_admin',
        createdAt: user.profile.createdAt.toISOString(),
        updatedAt: user.profile.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({ error: 'Failed to authenticate user' });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ message: 'Logged out successfully' });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      include: {
        user: true,
        currentPlan: true,
        userPlans: {
          where: {
            isActive: true,
            OR : [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });

    if (!profile || !profile.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const activeSubscription = profile.userPlans?.[0];

    return res.json({
      user: {
        id: profile.user.id,
        email: profile.user.email,
        role: profile.role,
      },
      profile: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        isAvailable: profile.isAvailable,
        totalInterpretations: profile.totalInterpretations,
        rating: profile.rating.toString(),
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        isSuperAdmin: profile.role === 'super_admin',
        currentPlan: profile.currentPlan ? {
          id: profile.currentPlan.id,
          name: profile.currentPlan.name,
          price: profile.currentPlan.price.toString(),
          currency: profile.currentPlan.currency,
          letterQuota: profile.currentPlan.letterQuota,
        } : null,
        subscription: activeSubscription
          ? {
            id: activeSubscription.id,
            planId: activeSubscription.planId,
            startedAt: activeSubscription.startedAt.toISOString(),
            expiresAt: activeSubscription.expiresAt?.toISOString() ?? null,
            lettersUsed: activeSubscription.lettersUsed,
            audioMinutesUsed: activeSubscription.audioMinutesUsed,
            plan: activeSubscription.plan
              ? {
                id: activeSubscription.plan.id,
                name: activeSubscription.plan.name,
                price: activeSubscription.plan.price.toString(),
                currency: activeSubscription.plan.currency,
                letterQuota: activeSubscription.plan.letterQuota,
              }
              : null,
          }
          : null,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Auth] Me error:', error);
    return res.status(500).json({ error: 'Failed to load user profile' });
  }
});

export default router;
