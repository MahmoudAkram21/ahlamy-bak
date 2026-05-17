import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { clearSessionCookie } from '../utils/session';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const router = Router();

router.patch('/update', requireAuth, async (req, res) => {
  try {
    const { fullName, bio, avatarUrl, city, countryCode } = req.body ?? {};
    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) updateData.fullName = fullName;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
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

    const updatedProfile = await prisma.profile.update({
      where: { id: req.user!.userId },
      data: updateData,
    });

    return res.json({
      profile: {
        id: updatedProfile.id,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        role: updatedProfile.role,
        avatarUrl: updatedProfile.avatarUrl,
        bio: updatedProfile.bio,
        city: updatedProfile.city,
        countryCode: updatedProfile.countryCode,
        isAvailable: updatedProfile.isAvailable,
        totalInterpretations: updatedProfile.totalInterpretations,
        rating: updatedProfile.rating.toString(),
        isAdmin: updatedProfile.role === 'admin' || updatedProfile.role === 'super_admin',
        isSuperAdmin: updatedProfile.role === 'super_admin',
        createdAt: updatedProfile.createdAt.toISOString(),
        updatedAt: updatedProfile.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Profile] Update error:', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.patch('/availability', requireAuth, async (req, res) => {
  try {
    const { isAvailable } = req.body ?? {};

    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({ error: 'isAvailable must be a boolean' });
    }

    const updatedProfile = await prisma.profile.update({
      where: { id: req.user!.userId },
      data: { isAvailable },
    });

    return res.json({
      profile: {
        id: updatedProfile.id,
        email: updatedProfile.email,
        fullName: updatedProfile.fullName,
        role: updatedProfile.role,
        isAvailable: updatedProfile.isAvailable,
        totalInterpretations: updatedProfile.totalInterpretations,
      },
    });
  } catch (error) {
    console.error('[Profile] Availability error:', error);
    return res.status(500).json({ error: 'Failed to update availability' });
  }
});

router.post('/upload-avatar', requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body ?? {};

    if (!avatar || typeof avatar !== 'string' || !avatar.startsWith('data:image')) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    const matches = avatar.match(/^data:image\/(\w+);base64,(.+)$/);

    if (!matches) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const imageType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const rootDir = join(process.cwd(), '..');
    const uploadsDir = join(rootDir, 'public', 'uploads', 'avatars');
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    const filename = `${req.user!.userId}-${Date.now()}.${imageType}`;
    const filepath = join(uploadsDir, filename);
    const avatarUrl = `/uploads/avatars/${filename}`;

    await writeFile(filepath, buffer);

    const updatedProfile = await prisma.profile.update({
      where: { id: req.user!.userId },
      data: { avatarUrl },
      select: {
        id: true,
        avatarUrl: true,
      },
    });

    return res.json({
      avatarUrl,
      profile: updatedProfile,
    });
  } catch (error) {
    console.error('[Profile] Upload avatar error:', error);
    return res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    await prisma.$transaction(async (tx) => {
      await tx.user.delete({
        where: { id: userId },
      });
    });

    clearSessionCookie(res);

    return res.json({ success: true });
  } catch (error) {
    console.error('[Profile] Delete account error:', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
