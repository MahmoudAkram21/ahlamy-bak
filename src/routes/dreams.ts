import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createNotification, createNotificationsForAdmins } from "../utils/notifications";

const router = Router();

async function getActiveSubscription(userId: string) {
  return prisma.userPlan.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      plan: true,
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}

function countContentLetters(content: string) {
  if (!content) return 0;
  // Count all Unicode characters (including Arabic, spaces, punctuation, etc.)
  // Array.from() properly handles Unicode surrogate pairs and Arabic characters
  return Array.from(content).length;
}

async function attachFeatureFlags(dreams: any[]) {
  if (dreams.length === 0) return dreams;

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT id, is_featured AS isFeatured, featured_at AS featuredAt
    FROM dreams
    WHERE id IN (${Prisma.join(dreams.map((dream) => dream.id))})
  `);
  const featureMap = new Map(rows.map((row) => [row.id, row]));

  return dreams.map((dream) => {
    const feature = featureMap.get(dream.id);
    return {
      ...dream,
      isFeatured: Boolean(feature?.isFeatured),
      featuredAt: feature?.featuredAt || null,
    };
  });
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    let dreams;

    if (profile.role === "dreamer") {
      dreams = await prisma.dream.findMany({
        where: { dreamerId: userId },
        orderBy: { createdAt: "desc" },
        include: {
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
      });
    } else if (profile.role === "interpreter") {
      dreams = await prisma.dream.findMany({
        where: {
          OR: [{ interpreterId: userId }, { interpreterId: null }],
        },
        orderBy: { createdAt: "desc" },
        include: {
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
      });
    } else if (profile.role === "admin" || profile.role === "super_admin") {
      dreams = await prisma.dream.findMany({
        orderBy: { createdAt: "desc" },
        include: {
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
      });
    } else {
      return res.status(403).json({ error: "Invalid role" });
    }

    return res.json(await attachFeatureFlags(dreams));
  } catch (error) {
    console.error("[Dreams] Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch dreams" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { title, description, dream_date, mood, audioMinutes, metadata } =
      req.body ?? {};

    if (!title || !description) {
      return res
        .status(400)
        .json({ error: "Title and description are required" });
    }

    // Get user profile to check role
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Admin and super_admin bypass plan checks
    const isAdmin = profile.role === "admin" || profile.role === "super_admin";

    // Count letters from description only (dream content)
    // Title is not counted - only the dream description/content
    let letterCount = countContentLetters(description);

    // For per-dream model: Create dream with pending_payment status
    // User will purchase a plan for this specific dream
    const dream = await prisma.dream.create({
      data: {
        dreamerId: userId,
        title,
        content: description, // Required field
        description,
        dreamDate: dream_date ? new Date(dream_date) : null,
        mood,
        status: isAdmin ? "new" : "pending_payment", // Admins bypass payment
        metadata: metadata || {},
      },
      include: {
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

    if (!isAdmin) {
      createNotificationsForAdmins(
        "dream_submitted",
        "A new dream has been submitted",
        dream.id,
        userId
      ).catch((error) => console.error("[Notifications] Dream submitted trigger error:", error));
    }

    return res.status(201).json(dream);
  } catch (error) {
    console.error("[Dreams] Create error:", error);
    return res.status(500).json({ error: "Failed to create dream" });
  }
});

// Upload voice recording for dream
router.post("/:id/audio", requireAuth, async (req, res) => {
  try {
    const { audio, duration } = req.body;

    if (
      !audio ||
      typeof audio !== "string" ||
      !audio.startsWith("data:audio")
    ) {
      return res.status(400).json({ error: "Invalid audio data" });
    }

    const matches = audio.match(/^data:audio\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: "Invalid audio format" });
    }

    const audioType = matches[1]; // 'webm', 'mp3', 'm4a', etc.
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Ensure audio directory exists
    const audioDir = join(__dirname, "../../public/uploads/audio");
    if (!existsSync(audioDir)) {
      mkdirSync(audioDir, { recursive: true });
    }

    const filename = `${req.user!.userId}-${Date.now()}.${audioType}`;
    const filepath = join(audioDir, filename);
    const audioUrl = `/uploads/audio/${filename}`;

    await writeFile(filepath, buffer);

    const dream = await prisma.dream.update({
      where: { id: req.params.id },
      data: {
        audioUrl,
        audioDuration: duration ? parseInt(duration) : null,
      },
    });

    console.log(`[Dreams] Audio uploaded for dream ${req.params.id}`);
    return res.json({ audioUrl, dream });
  } catch (error) {
    console.error("[Dreams] Audio upload error:", error);
    return res.status(500).json({ error: "Failed to upload audio" });
  }
});

router.get("/stats", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    let where: Record<string, unknown> = {};

    if (profile.role === "interpreter") {
      where = {
        OR: [{ interpreterId: userId }, { interpreterId: null }],
      };
    } else if (profile.role === "dreamer") {
      where = { dreamerId: userId };
    }

    const dreams = await prisma.dream.findMany({
      where,
      select: { status: true },
    });

    const stats = {
      total: dreams.length,
      new: dreams.filter((d) => d.status === "new").length,
      pending_inquiry: dreams.filter((d) => d.status === "pending_inquiry")
        .length,
      pending_interpretation: dreams.filter(
        (d) => d.status === "pending_interpretation"
      ).length,
      interpreted: dreams.filter((d) => d.status === "interpreted").length,
      returned: dreams.filter((d) => d.status === "returned").length,
    };

    return res.json(stats);
  } catch (error) {
    console.error("[Dreams] Stats error:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/featured", async (_req, res) => {
  try {
    const dreams = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        id,
        title,
        content,
        interpretation,
        status,
        created_at AS createdAt,
        featured_at AS featuredAt
      FROM dreams
      WHERE is_featured = true
      ORDER BY featured_at DESC, created_at DESC
      LIMIT 12
    `);

    return res.json({
      dreams: dreams.map((dream) => ({
        id: dream.id,
        title: dream.title,
        preview: dream.content,
        interpretation: dream.interpretation,
        status: dream.status,
        createdAt: dream.createdAt,
        featuredAt: dream.featuredAt,
      })),
    });
  } catch (error) {
    console.error("[Dreams] Featured fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch featured dreams" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const dream = await prisma.dream.findUnique({
      where: { id },
      include: {
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
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin =
      profile?.role === "admin" || profile?.role === "super_admin";
    const hasAccess =
      dream.dreamerId === userId || dream.interpreterId === userId || isAdmin;

    if (!hasAccess) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(dream);
  } catch (error) {
    console.error("[Dreams] Fetch single error:", error);
    return res.status(500).json({ error: "Failed to fetch dream" });
  }
});

router.patch("/:id/feature", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { isFeatured } = req.body ?? {};
    const userId = req.user!.userId;

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

    if (!isAdmin) {
      return res.status(403).json({ error: "Forbidden - Admin access required" });
    }

    const nextFeatured = Boolean(isFeatured);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE dreams
      SET is_featured = ${nextFeatured}, featured_at = ${nextFeatured ? new Date() : null}
      WHERE id = ${id}
    `);

    const dream = await prisma.dream.findUnique({
      where: { id },
      include: {
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
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const [formattedDream] = await attachFeatureFlags([dream]);
    return res.json({ dream: formattedDream });
  } catch (error) {
    console.error("[Dreams] Feature update error:", error);
    return res.status(500).json({ error: "Failed to update featured dream" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { status, interpretation, notes, interpreter_id } = req.body ?? {};

    const dream = await prisma.dream.findUnique({ where: { id } });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === "super_admin";
    const isAdmin = role === "admin";
    const isInterpreter =
      role === "interpreter" && dream.interpreterId === userId;
    const isDreamer = role === "dreamer" && dream.dreamerId === userId;

    const canModifyContent = isSuperAdmin || isInterpreter || isDreamer;

    if (!canModifyContent && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updateData: Record<string, unknown> = {};
    if (status) {
      if (!canModifyContent && !isSuperAdmin) {
        return res.status(403).json({
          error:
            "Only the assigned interpreter, dreamer, or super admin can update status",
        });
      }
      updateData.status = status;
    }
    if (interpretation) {
      if (!isSuperAdmin && !isInterpreter) {
        return res.status(403).json({
          error:
            "Only the assigned interpreter or super admin can add interpretation",
        });
      }
      updateData.interpretation = interpretation;
    }
    if (notes) {
      if (!canModifyContent && !isSuperAdmin) {
        return res.status(403).json({ error: "Forbidden" });
      }
      updateData.notes = notes;
    }
    if (interpreter_id) {
      if (!isAdmin && !isSuperAdmin) {
        return res
          .status(403)
          .json({ error: "Only admins can assign interpreters" });
      }
      updateData.interpreterId = interpreter_id;
      if (!updateData.status) {
        updateData.status = "pending_interpretation";
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    const updatedDream = await prisma.dream.update({
      where: { id },
      data: updateData,
      include: {
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
    });

    if (interpreter_id && interpreter_id !== dream.interpreterId) {
      Promise.all([
        createNotification(
          dream.dreamerId,
          "dream_assigned",
          "Your dream has been assigned to an interpreter",
          id
        ),
        createNotification(
          interpreter_id,
          "dream_assigned",
          "A new dream has been assigned to you",
          id
        ),
      ]).catch((error) => console.error("[Notifications] Dream assignment trigger error:", error));
    }

    if (status && status !== dream.status && !interpreter_id) {
      const recipients = [dream.dreamerId, dream.interpreterId].filter(
        (recipientId): recipientId is string => Boolean(recipientId && recipientId !== userId)
      );

      if (recipients.length > 0) {
        Promise.all(
          recipients.map((recipientId) =>
            createNotification(
              recipientId,
              "dream_status_changed",
              `Dream status changed to ${status}`,
              id
            )
          )
        ).catch((error) => console.error("[Notifications] Dream status trigger error:", error));
      }
    }

    return res.json(updatedDream);
  } catch (error) {
    console.error("[Dreams] Update error:", error);
    return res.status(500).json({ error: "Failed to update dream" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const dream = await prisma.dream.findUnique({ where: { id } });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const isAdmin =
      profile?.role === "admin" || profile?.role === "super_admin";

    if (dream.dreamerId !== userId && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await prisma.dream.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Dreams] Delete error:", error);
    return res.status(500).json({ error: "Failed to delete dream" });
  }
});

export default router;
