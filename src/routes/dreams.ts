import { Router } from "express";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { createNotification } from "../utils/notifications";
import { applyPendingCompletionIfDue } from "../utils/requestCompletion";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const VERIFICATION_MESSAGE =
  "المفسر أنهى التفسير ويرجو التأكيد. إذا لم ترد خلال 10 دقائق سيُعتبر التفسير مكتملاً. هل توافق؟ (نعم / لا)";
const PENDING_COMPLETION_MINUTES = 10;
const EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes for dream content and message edits

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

const dreamListInclude = {
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
};

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
        include: dreamListInclude,
      });
    } else if (profile.role === "interpreter") {
      dreams = await prisma.dream.findMany({
        where: {
          interpreterId: userId,
          status: { not: "pending_payment" },
        },
        orderBy: { createdAt: "desc" },
        include: dreamListInclude,
      });
    } else if (profile.role === "admin" || profile.role === "super_admin") {
      dreams = await prisma.dream.findMany({
        orderBy: { createdAt: "desc" },
        include: dreamListInclude,
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

/** Dreamer (and admin): dreams they submitted for interpretation */
router.get("/my-dreams", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (
      profile.role !== "dreamer" &&
      profile.role !== "admin" &&
      profile.role !== "super_admin"
    ) {
      return res
        .status(403)
        .json({ error: "Only dreamers can list their dreams" });
    }
    const dreams = await prisma.dream.findMany({
      where: { dreamerId: userId },
      orderBy: { createdAt: "desc" },
      include: dreamListInclude,
    });
    return res.json(dreams);
  } catch (error) {
    console.error("[Dreams] My dreams fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch my dreams" });
  }
});

/** Interpreter (and admin): dreams assigned to them for interpretation */
router.get("/assigned", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (
      profile.role !== "interpreter" &&
      profile.role !== "admin" &&
      profile.role !== "super_admin"
    ) {
      return res
        .status(403)
        .json({ error: "Only interpreters can list assigned dreams" });
    }
    const dreams = await prisma.dream.findMany({
      where: {
        interpreterId: userId,
        status: { not: "pending_payment" },
      },
      orderBy: { createdAt: "desc" },
      include: dreamListInclude,
    });
    return res.json(dreams);
  } catch (error) {
    console.error("[Dreams] Assigned dreams fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch assigned dreams" });
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

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

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

    const isDreamerOrInterpreter =
      profile.role === "dreamer" || profile.role === "interpreter";
    const oneMonthAgo = new Date(Date.now() - ONE_MONTH_MS);

    let where: Record<string, unknown> = {};
    if (profile.role === "interpreter") {
      where = { interpreterId: userId };
    } else if (profile.role === "dreamer") {
      where = { dreamerId: userId };
    } else if (profile.role === "admin" || profile.role === "super_admin") {
      where = {};
    }

    if (isDreamerOrInterpreter) {
      where.createdAt = { gte: oneMonthAgo };
    }

    const dreams = await prisma.dream.findMany({
      where,
      select: { status: true },
    });

    const isInterpreter = profile.role === "interpreter";
    const dreamsForStats = isInterpreter
      ? dreams.filter((d) => d.status !== "pending_payment")
      : dreams;

    const stats = {
      period: isDreamerOrInterpreter ? "month" : "all",
      total: dreamsForStats.length,
      new: dreamsForStats.filter((d) => d.status === "new").length,
      pending_payment: isInterpreter
        ? 0
        : dreams.filter((d) => d.status === "pending_payment").length,
      pending_inquiry: dreamsForStats.filter(
        (d) => d.status === "pending_inquiry"
      ).length,
      pending_interpretation: dreamsForStats.filter(
        (d) => d.status === "pending_interpretation"
      ).length,
      interpreted: dreamsForStats.filter(
        (d) => d.status === "interpreted"
      ).length,
      returned: dreamsForStats.filter((d) => d.status === "returned").length,
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
        interpreterRating: {
          select: { rating: true },
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

    const isInterpreterViewer =
      profile?.role === "interpreter" && dream.interpreterId === userId;
    if (isInterpreterViewer && dream.status === "pending_payment") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Apply 10-minute auto-completion if interpreter had requested completion and time passed
    try {
      const requestRow = dream.interpreterId
        ? await prisma.request.findFirst({
            where: {
              dreamId: id,
              interpreterId: dream.interpreterId,
            },
            select: { id: true },
          })
        : null;
      if (requestRow) {
        const applied = await applyPendingCompletionIfDue(prisma, requestRow.id);
        if (applied) {
          const updated = await prisma.dream.findUnique({
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
              interpreterRating: {
                select: { rating: true },
              },
            },
          });
          return res.json(updated ?? dream);
        }
      }
    } catch (completionError) {
      console.error("[Dreams] Pending completion check error (non-fatal):", completionError);
      // Still return the dream so the page loads
    }

    return res.json(dream);
  } catch (error) {
    console.error("[Dreams] Fetch single error:", error);
    return res.status(500).json({ error: "Failed to fetch dream" });
  }
});

/** Interpreter requests completion: send verification message to dreamer, 10min timer; if no reply, dream becomes done */
router.post("/:id/request-completion", requireAuth, async (req, res) => {
  try {
    const { id: dreamId } = req.params;
    const userId = req.user!.userId;

    const dream = await prisma.dream.findUnique({
      where: { id: dreamId },
      select: {
        id: true,
        status: true,
        dreamerId: true,
        interpreterId: true,
      },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }
    if (dream.interpreterId !== userId) {
      return res.status(403).json({
        error: "Only the assigned interpreter can request completion",
      });
    }
    if (dream.status === "interpreted") {
      return res.status(400).json({ error: "Dream is already interpreted" });
    }

    const request = await prisma.request.findFirst({
      where: {
        dreamId,
        interpreterId: userId,
      },
      select: { id: true },
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found for this dream" });
    }

    const deadline = new Date(Date.now() + PENDING_COMPLETION_MINUTES * 60 * 1000);

    await prisma.request.update({
      where: { id: request.id },
      data: { pendingCompletionAt: deadline },
    });

    await prisma.chatMessage.create({
      data: {
        requestId: request.id,
        senderId: userId,
        content: VERIFICATION_MESSAGE,
        messageType: "text",
      },
    });

    // Also create a Dream Message so it appears in "الرسائل" on the dream page (same list the dreamer sees)
    const dreamMessage = await prisma.message.create({
      data: {
        dreamId,
        senderId: userId,
        content: VERIFICATION_MESSAGE,
        messageType: "text",
      },
      include: {
        sender: { select: { id: true, role: true } },
      },
    });
    const anonymousDreamMessage = {
      ...dreamMessage,
      sender: {
        id: dreamMessage.sender.id,
        role: dreamMessage.sender.role,
        displayName: dreamMessage.sender.role === "dreamer" ? "الرائي" : "المفسر",
      },
    };
    const io = req.app.get("io");
    if (io) {
      io.to(`dream:${dreamId}`).emit("message:new", anonymousDreamMessage);
    }

    // Notify dreamer so they see it in the app (bell icon)
    await createNotification(prisma, {
      recipientId: dream.dreamerId,
      type: "SYSTEM",
      title: "طلب تأكيد من المفسر",
      message: VERIFICATION_MESSAGE,
      entityId: dreamId,
      entityType: "DREAM",
    });

    return res.json({
      success: true,
      message:
        "تم إرسال طلب التأكيد للرائي. إذا لم يرد خلال 10 دقائق سيُعتبر التفسير مكتملاً.",
      pendingCompletionAt: deadline.toISOString(),
    });
  } catch (error) {
    console.error("[Dreams] Request completion error:", error);
    return res.status(500).json({ error: "Failed to request completion" });
  }
});

/** Interpreter can reopen an interpreted dream to allow chat again */
router.post("/:id/reopen", requireAuth, async (req, res) => {
  try {
    const { id: dreamId } = req.params;
    const userId = req.user!.userId;

    const dream = await prisma.dream.findUnique({
      where: { id: dreamId },
      select: {
        id: true,
        status: true,
        interpreterId: true,
      },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }
    if (dream.interpreterId !== userId) {
      return res.status(403).json({
        error: "Only the assigned interpreter can reopen this dream",
      });
    }
    if (dream.status !== "interpreted") {
      return res.status(400).json({ error: "Dream is not interpreted" });
    }

    const requestRow = await prisma.request.findFirst({
      where: {
        dreamId,
        interpreterId: userId,
      },
      select: { id: true },
    });

    if (!requestRow) {
      return res.status(404).json({ error: "Request not found" });
    }

    await prisma.$transaction([
      prisma.request.update({
        where: { id: requestRow.id },
        data: {
          status: "in_progress",
          completedAt: null,
          pendingCompletionAt: null,
        },
      }),
      prisma.dream.update({
        where: { id: dreamId },
        data: { status: "pending_interpretation" },
      }),
    ]);

    const updated = await prisma.dream.findUnique({
      where: { id: dreamId },
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
        interpreterRating: { select: { rating: true } },
      },
    });

    return res.json(updated);
  } catch (error) {
    console.error("[Dreams] Reopen error:", error);
    return res.status(500).json({ error: "Failed to reopen dream" });
  }
});

router.post("/:id/rate", requireAuth, async (req, res) => {
  try {
    const { id: dreamId } = req.params;
    const userId = req.user!.userId;
    const { rating: ratingValue } = req.body ?? {};

    const rating = typeof ratingValue === "number" ? ratingValue : parseInt(String(ratingValue), 10);
    if (Number.isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be a number between 1 and 5" });
    }

    const dream = await prisma.dream.findUnique({
      where: { id: dreamId },
      select: { dreamerId: true, interpreterId: true, status: true },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }
    if (dream.dreamerId !== userId) {
      return res.status(403).json({ error: "Only the dreamer can rate the interpreter for this dream" });
    }
    if (dream.status !== "interpreted") {
      return res.status(400).json({ error: "Can only rate after the dream has been interpreted" });
    }
    if (!dream.interpreterId) {
      return res.status(400).json({ error: "No interpreter assigned to this dream" });
    }

    const interpreterId = dream.interpreterId;

    await prisma.interpreterRating.upsert({
      where: { dreamId },
      create: {
        dreamId,
        interpreterId,
        dreamerId: userId,
        rating,
      },
      update: { rating },
    });

    const allRatings = await prisma.interpreterRating.findMany({
      where: { interpreterId },
      select: { rating: true },
    });
    const avg = allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length;
    const rounded = Math.round(avg * 100) / 100;

    await prisma.profile.update({
      where: { id: interpreterId },
      data: { rating: rounded },
    });

    return res.json({ success: true, rating: rounded });
  } catch (error) {
    console.error("[Dreams] Rate error:", error);
    return res.status(500).json({ error: "Failed to save rating" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { status, interpretation, notes, interpreter_id, content: dreamContent } = req.body ?? {};

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
    if (dreamContent !== undefined && typeof dreamContent === "string") {
      if (!isDreamer && !isSuperAdmin) {
        return res.status(403).json({ error: "Only the dreamer can edit dream content" });
      }
      const dreamCreatedAt = new Date((dream as { createdAt: Date }).createdAt).getTime();
      if (Date.now() - dreamCreatedAt > EDIT_WINDOW_MS) {
        return res.status(400).json({ error: "Dream content can only be edited within 10 minutes of creation" });
      }
      updateData.content = dreamContent.trim();
    }
    if (status) {
      if (!canModifyContent && !isSuperAdmin) {
        return res.status(403).json({
          error:
            "Only the assigned interpreter, dreamer, or super admin can update status",
        });
      }
      updateData.status = status;
      if (status === "returned") {
        updateData.interpreterId = null;
      }
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
        interpreterRating: { select: { rating: true } },
      },
    });

    if (updateData.content !== undefined) {
      const io = req.app.get("io");
      if (io) {
        io.to(`dream:${id}`).emit("dream:updated", {
          id,
          content: updatedDream.content,
        });
      }
    }

    // When interpreter marks dream as interpreted: increment totalInterpretations only if
    // the request for this dream was not already completed (avoid double count)
    if (status === "interpreted" && dream.interpreterId) {
      const req = await prisma.request.findFirst({
        where: { dreamId: id },
        select: { status: true },
      });
      if (!req || req.status !== "completed") {
        await prisma.profile.update({
          where: { id: dream.interpreterId },
          data: { totalInterpretations: { increment: 1 } },
        });
      }
    }

    // When dream is returned (by dreamer or interpreter via dreams API): sync Request(s)
    if (status === "returned") {
      await prisma.request.updateMany({
        where: { dreamId: id },
        data: { status: "returned", interpreterId: null },
      });
    }

    // Sync Request when admin assigns interpreter: so interpreter sees it in their dashboard
    if (interpreter_id) {
      const existingRequest = await prisma.request.findFirst({
        where: { dreamId: id },
      });
      if (existingRequest) {
        await prisma.request.update({
          where: { id: existingRequest.id },
          data: {
            interpreterId: interpreter_id,
            status: "in_progress",
          },
        });
      } else {
        await prisma.request.create({
          data: {
            dreamId: id,
            dreamerId: dream.dreamerId,
            interpreterId: interpreter_id,
            title: dream.title,
            description: dream.description ?? undefined,
            status: "in_progress",
          },
        });
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
