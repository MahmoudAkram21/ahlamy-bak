import { Router } from 'express';
import prisma from '../lib/prisma';
import { hashPassword, verifyPassword, generateToken } from '../utils/auth';
import { setSessionCookie, clearSessionCookie } from '../utils/session';
import { requireAuth } from '../middleware/auth';
import { Prisma } from '@prisma/client';

const router = Router();

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const ALLOWED_SELF_SERVICE_ROLES = new Set(['dreamer', 'interpreter']);

const normalizeRequiredString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeCountryCode = (value: unknown) =>
  normalizeRequiredString(value).toUpperCase();

function normalizeEmail(value: unknown) {
  return normalizeRequiredString(value).toLowerCase();
}

function formatInterpreterApplication(application: any) {
  return {
    id: application.id,
    fullName: application.fullName,
    email: application.email,
    city: application.city,
    countryCode: application.countryCode,
    status: application.status,
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
    city,
    country_code AS countryCode,
    status,
    reviewed_at AS reviewedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM interpreter_applications
`;

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      fullName,
      role = 'dreamer',
      city: rawCity,
      countryCode: rawCountryCode,
    } = req.body ?? {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedFullName = normalizeRequiredString(fullName);
    const city = normalizeRequiredString(rawCity);
    const countryCode = normalizeCountryCode(rawCountryCode);

    if (!normalizedEmail || !normalizedFullName || !city || !countryCode) {
      return res.status(400).json({ error: 'Email, full name, city, and country code are required' });
    }

    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(400).json({ error: 'countryCode must be a valid ISO-2 country code' });
    }

    if (!ALLOWED_SELF_SERVICE_ROLES.has(role)) {
      return res.status(403).json({ error: 'You are not allowed to register with this role' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    if (role === 'interpreter') {
      const [existingApplication] = await prisma.$queryRaw<any[]>(Prisma.sql`
        ${interpreterApplicationSelect}
        WHERE email = ${normalizedEmail}
        LIMIT 1
      `);

      if (existingApplication) {
        if (existingApplication.status === 'rejected') {
          await prisma.$executeRaw(Prisma.sql`
            UPDATE interpreter_applications
            SET
              full_name = ${normalizedFullName},
              city = ${city},
              country_code = ${countryCode},
              status = 'resubmitted',
              notes = NULL,
              reviewed_at = NULL,
              updated_at = ${new Date()}
            WHERE id = ${existingApplication.id}
          `);

          const [application] = await prisma.$queryRaw<any[]>(Prisma.sql`
            ${interpreterApplicationSelect}
            WHERE id = ${existingApplication.id}
            LIMIT 1
          `);

          return res.status(202).json({
            application: formatInterpreterApplication(application),
            message: 'Interpreter registration request resubmitted and is pending admin approval',
          });
        }

        if (existingApplication.status === 'approved') {
          return res.status(409).json({ error: 'This interpreter application has already been approved' });
        }

        return res.status(409).json({ error: 'Interpreter registration request is already pending review' });
      }

      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO interpreter_applications (
          id,
          full_name,
          email,
          city,
          country_code,
          status,
          created_at,
          updated_at
        )
        VALUES (
          UUID(),
          ${normalizedFullName},
          ${normalizedEmail},
          ${city},
          ${countryCode},
          'pending',
          ${new Date()},
          ${new Date()}
        )
      `);

      const [application] = await prisma.$queryRaw<any[]>(Prisma.sql`
        ${interpreterApplicationSelect}
        WHERE email = ${normalizedEmail}
        LIMIT 1
      `);

      return res.status(202).json({
        application: formatInterpreterApplication(application),
        message: 'Interpreter registration request submitted and is pending admin approval',
      });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const hashedPassword = await hashPassword(password);

    const { user, profile } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
        },
      });

      const createdProfile = await tx.profile.create({
        data: {
          id: createdUser.id,
          email: createdUser.email,
          fullName: normalizedFullName,
          role,
          city,
          countryCode,
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
        city: profile.city,
        countryCode: profile.countryCode,
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

    const user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { profile: true },
    });

    if (!user || !user.profile || user.profile.deletedAt) {
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
        city: user.profile.city,
        countryCode: user.profile.countryCode,
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

router.patch('/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, password: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await verifyPassword(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Change password error:', error);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ message: 'Logged out successfully' });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        user: true,
      },
    });

    if (!profile || !profile.user) {
      return res.status(404).json({ error: 'User not found' });
    }

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
        city: profile.city,
        countryCode: profile.countryCode,
        isAvailable: profile.isAvailable,
        totalInterpretations: profile.totalInterpretations,
        rating: profile.rating.toString(),
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        isSuperAdmin: profile.role === 'super_admin',
        currentPlan: null,
        subscription: null,
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
