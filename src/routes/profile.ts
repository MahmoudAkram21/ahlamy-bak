import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { clearSessionCookie } from '../utils/session.js';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { buildProfileVisionStatsPdf } from '../utils/pdf-vision-stats.js';

const router = Router();

router.patch('/update', requireAuth, async (req, res) => {
  try {
    const { fullName, bio, avatarUrl } = req.body ?? {};
    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) updateData.fullName = fullName;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

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

const VISION_TYPES = ['gold_sa', 'silver_sa', 'bronze_sa', 'gold_eg', 'silver_eg', 'bronze_eg'] as const;

function getMonthRange(monthParam?: string): { start: Date; end: Date } {
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    return {
      start: new Date(y, m - 1, 1),
      end: new Date(y, m, 0, 23, 59, 59, 999),
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(),
  };
}

router.get('/interpretation-stats-by-type/export', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const month = req.query.month as string | undefined;
    const format = (req.query.format as string) || 'json';
    const { start, end } = getMonthRange(month);

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true, fullName: true, email: true },
    });
    if (profile?.role !== 'interpreter') {
      return res.status(403).json({ error: 'For interpreters only' });
    }

    const completed = await prisma.request.findMany({
      where: {
        status: 'completed',
        interpreterId: userId,
        completedAt: { gte: start, lte: end },
      },
      select: { dream: { select: { visionType: true } } },
    });

    const counts: Record<string, number> = Object.fromEntries(VISION_TYPES.map((t) => [t, 0]));
    let total = 0;
    for (const r of completed) {
      const vt = r.dream?.visionType && VISION_TYPES.includes(r.dream.visionType as any) ? r.dream.visionType : 'other';
      if (vt !== 'other') counts[vt] = (counts[vt] || 0) + 1;
      total += 1;
    }

    const labels: Record<string, string> = {
      gold_sa: 'ذهبي سعودي',
      silver_sa: 'فضي سعودي',
      bronze_sa: 'برونزي سعودي',
      gold_eg: 'ذهبي مصري',
      silver_eg: 'فضي مصري',
      bronze_eg: 'برونزي مصري',
    };

    if (format === 'txt' || format === 'doc') {
      let body = `إحصائيات الرؤى حسب النوع\nالفترة: ${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}\nالمفسر: ${profile.fullName || profile.email}\n\n`;
      for (const t of VISION_TYPES) {
        body += `${labels[t]}: ${counts[t] || 0}\n`;
      }
      body += `\nالإجمالي: ${total}\n`;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.txt"`);
      return res.send(Buffer.from(body, 'utf-8'));
    }
    if (format === 'pdf') {
      const dateRange = `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}`;
      const pdfBuffer = await buildProfileVisionStatsPdf({
        interpreterName: profile.fullName || profile.email,
        monthLabel: month || 'current',
        dateRange,
        counts,
        total,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.pdf"`);
      return res.send(pdfBuffer);
    }
    res.setHeader('Content-Disposition', `attachment; filename="vision-stats-${month || 'current'}.json"`);
    return res.json({ month: month || 'current', start, end, counts, total, labels });
  } catch (error) {
    console.error('[Profile] Export stats error:', error);
    return res.status(500).json({ error: 'Failed to export' });
  }
});

router.get('/interpretation-stats-by-type', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const month = req.query.month as string | undefined;
    const { start, end } = getMonthRange(month);

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (profile?.role !== 'interpreter') {
      return res.status(403).json({ error: 'For interpreters only' });
    }

    const completed = await prisma.request.findMany({
      where: {
        status: 'completed',
        interpreterId: userId,
        completedAt: { gte: start, lte: end },
      },
      select: {
        dream: { select: { visionType: true } },
      },
    });

    const counts: Record<string, number> = Object.fromEntries(VISION_TYPES.map((t) => [t, 0]));
    let total = 0;
    for (const r of completed) {
      const vt = r.dream?.visionType && VISION_TYPES.includes(r.dream.visionType as any) ? r.dream.visionType : 'other';
      if (vt !== 'other') {
        counts[vt] = (counts[vt] || 0) + 1;
      }
      total += 1;
    }

    return res.json({
      month: month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
      start,
      end,
      counts,
      total,
    });
  } catch (error) {
    console.error('[Profile] Interpretation stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
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
