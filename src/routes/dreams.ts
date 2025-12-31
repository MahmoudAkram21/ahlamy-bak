import { Router } from "express";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

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

    return res.json(dreams);
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

    if (dream.dreamerId !== userId) {
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
