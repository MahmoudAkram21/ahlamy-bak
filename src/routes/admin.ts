import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../utils/auth';
import { normalizeReviewText } from '../utils/reviewText';

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

function formatInterpreterApplication(application: any) {
  return {
    id: application.id,
    fullName: application.fullName,
    email: application.email,
    phone: application.phone,
    city: application.city,
    countryCode: application.countryCode,
    bio: application.bio,
    qualifications: application.qualifications,
    experienceYears: application.experienceYears,
    status: application.status,
    notes: application.notes,
    reviewedAt: application.reviewedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

const interpreterApplicationSelect = Prisma.sql`
  SELECT
    id,
    full_name AS fullName,
    email,
    phone,
    city,
    country_code AS countryCode,
    bio,
    qualifications,
    experience_years AS experienceYears,
    status,
    notes,
    reviewed_at AS reviewedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM interpreter_applications
`;

const notificationAudienceRoles = {
  all: ['dreamer', 'interpreter', 'admin', 'super_admin'],
  dreamers: ['dreamer'],
  interpreters: ['interpreter'],
} as const;

const reviewSelect = Prisma.sql`
  SELECT
    id,
    reviewer_name AS reviewerName,
    content,
    rating,
    source,
    is_featured AS isFeatured,
    is_published AS isPublished,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM reviews
`;

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
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

router.get('/reviews', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const reviews = await prisma.$queryRaw<any[]>(Prisma.sql`
      ${reviewSelect}
      ORDER BY created_at DESC
      LIMIT 250
    `);

    return res.json({
      reviews: reviews.map((review) =>
        normalizeReviewText({
          ...review,
          isFeatured: Boolean(review.isFeatured),
          isPublished: Boolean(review.isPublished),
        }),
      ),
    });
  } catch (error) {
    console.error('[Admin] Reviews fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

router.patch('/reviews/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const { isFeatured, isPublished } = req.body ?? {};
    const updates: Prisma.Sql[] = [];

    if (isFeatured !== undefined) updates.push(Prisma.sql`is_featured = ${Boolean(isFeatured)}`);
    if (isPublished !== undefined) updates.push(Prisma.sql`is_published = ${Boolean(isPublished)}`);

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    updates.push(Prisma.sql`updated_at = ${new Date()}`);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE reviews
      SET ${Prisma.join(updates)}
      WHERE id = ${req.params.id}
    `);

    const [review] = await prisma.$queryRaw<any[]>(Prisma.sql`
      ${reviewSelect}
      WHERE id = ${req.params.id}
      LIMIT 1
    `);

    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    return res.json({
      review: normalizeReviewText({
        ...review,
        isFeatured: Boolean(review.isFeatured),
        isPublished: Boolean(review.isPublished),
      }),
    });
  } catch (error) {
    console.error('[Admin] Review update error:', error);
    return res.status(500).json({ error: 'Failed to update review' });
  }
});

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const notifications = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        n.id,
        n.type,
        n.message,
        n.is_read AS isRead,
        n.reference_id AS referenceId,
        n.created_at AS createdAt,
        p.id AS userId,
        p.email AS userEmail,
        p.full_name AS userFullName,
        p.role AS userRole
      FROM notifications n
      INNER JOIN profiles p ON p.id = n.user_id
      WHERE n.type = 'admin_broadcast'
      ORDER BY n.created_at DESC
      LIMIT 100
    `);

    return res.json({
      notifications: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        message: notification.message,
        isRead: Boolean(notification.isRead),
        referenceId: notification.referenceId,
        createdAt: notification.createdAt,
        user: {
          id: notification.userId,
          email: notification.userEmail,
          fullName: notification.userFullName,
          role: notification.userRole,
        },
      })),
    });
  } catch (error) {
    console.error('[Admin] Notifications fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.post('/notifications/broadcast', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const { audience = 'all', message } = req.body ?? {};
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';

    if (!Object.prototype.hasOwnProperty.call(notificationAudienceRoles, audience)) {
      return res.status(400).json({ error: 'Invalid notification audience' });
    }

    if (!normalizedMessage || normalizedMessage.length > 500) {
      return res.status(400).json({ error: 'Notification message is required and must be 500 characters or less' });
    }

    const roles = notificationAudienceRoles[audience as keyof typeof notificationAudienceRoles];
    const recipients = await prisma.profile.findMany({
      where: { role: { in: [...roles] } },
      select: { id: true },
    });

    if (recipients.length === 0) {
      return res.json({ count: 0 });
    }

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO notifications (id, user_id, type, message, is_read, reference_id, created_at)
      SELECT UUID(), id, 'admin_broadcast', ${normalizedMessage}, false, NULL, NOW(3)
      FROM profiles
      WHERE role IN (${Prisma.join([...roles])})
    `);

    return res.status(201).json({ count: recipients.length });
  } catch (error) {
    console.error('[Admin] Notification broadcast error:', error);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
});

router.get('/interpreter-applications', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const applications = await prisma.$queryRaw<any[]>(Prisma.sql`
      ${interpreterApplicationSelect}
      ORDER BY status ASC, created_at DESC
      LIMIT 250
    `);

    return res.json({ applications: applications.map(formatInterpreterApplication) });
  } catch (error) {
    console.error('[Admin] Interpreter applications error:', error);
    return res.status(500).json({ error: 'Failed to fetch interpreter applications' });
  }
});

router.patch('/interpreter-applications/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const { id } = req.params;
    const { status, notes } = req.body ?? {};
    const updateData: Record<string, unknown> = {};

    if (status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid application status' });
      }
      updateData.status = status;
      updateData.reviewedAt = status === 'pending' ? null : new Date();
    }

    if (notes !== undefined) {
      if (notes !== null && typeof notes !== 'string') {
        return res.status(400).json({ error: 'notes must be a string or null' });
      }
      updateData.notes = notes;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    const updates: Prisma.Sql[] = [];

    if (Object.prototype.hasOwnProperty.call(updateData, 'status')) {
      updates.push(Prisma.sql`status = ${updateData.status as string}`);
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'reviewedAt')) {
      updates.push(Prisma.sql`reviewed_at = ${updateData.reviewedAt as Date | null}`);
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'notes')) {
      updates.push(Prisma.sql`notes = ${updateData.notes as string | null}`);
    }

    updates.push(Prisma.sql`updated_at = ${new Date()}`);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE interpreter_applications
      SET ${Prisma.join(updates)}
      WHERE id = ${id}
    `);

    const [application] = await prisma.$queryRaw<any[]>(Prisma.sql`
      ${interpreterApplicationSelect}
      WHERE id = ${id}
      LIMIT 1
    `);

    if (!application) {
      return res.status(404).json({ error: 'Interpreter application not found' });
    }

    return res.json({ application: formatInterpreterApplication(application) });
  } catch (error) {
    console.error('[Admin] Interpreter application update error:', error);
    return res.status(500).json({ error: 'Failed to update interpreter application' });
  }
});

router.delete('/interpreter-applications/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM interpreter_applications
      WHERE id = ${req.params.id}
    `);

    return res.json({ success: true });
  } catch (error) {
    console.error('[Admin] Interpreter application delete error:', error);
    return res.status(500).json({ error: 'Failed to delete interpreter application' });
  }
});

router.get('/payments', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
        plan: {
          select: {
            id: true,
            name: true,
            currency: true,
          },
        },
      },
      take: 250,
    });

    return res.json({
      payments: payments.map((payment) => ({
        id: payment.id,
        userId: payment.userId,
        planId: payment.planId,
        dreamId: payment.dreamId,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        reference: payment.reference,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        user: payment.user,
        plan: payment.plan,
      })),
    });
  } catch (error) {
    console.error('[Admin] Payments error:', error);
    return res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

router.get('/users', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const isAdmin = await ensureRole(userId, ['admin', 'super_admin']);

    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    const users = await prisma.profile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        city: true,
        countryCode: true,
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
    const {
      email,
      password,
      fullName,
      role = 'dreamer',
      isAvailable = true,
      city = 'Cairo',
      countryCode = 'EG',
    } = req.body ?? {};
    const normalizedCity = typeof city === 'string' ? city.trim() : '';
    const normalizedCountryCode = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';

    const isSuperAdmin = await ensureRole(requesterId, ['admin', 'super_admin']);

    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Forbidden - Super admin access required' });
    }

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!normalizedCity || !/^[A-Z]{2}$/.test(normalizedCountryCode)) {
      return res.status(400).json({ error: 'Valid city and ISO-2 countryCode are required' });
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
          city: normalizedCity,
          countryCode: normalizedCountryCode,
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
        city: profile.city,
        countryCode: profile.countryCode,
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
    const { fullName, role, isAvailable, totalInterpretations, rating, city, countryCode } = req.body ?? {};

    const isSuperAdmin = await ensureRole(requesterId, ['admin', 'super_admin']);

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

    if (city !== undefined) {
      if (typeof city !== 'string' || !city.trim()) {
        return res.status(400).json({ error: 'city must be a non-empty string' });
      }
      updateData.city = city.trim();
    }

    if (countryCode !== undefined) {
      if (typeof countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(countryCode.trim())) {
        return res.status(400).json({ error: 'countryCode must be a valid ISO-2 country code' });
      }
      updateData.countryCode = countryCode.trim().toUpperCase();
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
        city: true,
        countryCode: true,
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

    const isSuperAdmin = await ensureRole(requesterId, ['admin', 'super_admin']);

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
        city: true,
        countryCode: true,
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



