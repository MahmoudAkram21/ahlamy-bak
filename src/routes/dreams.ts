import { Router } from "express";
import { Prisma, SubmissionType } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const router = Router();
const bypassPaymentGateway = process.env.BYPASS_PAYMENT_GATEWAY === "true";

function countLetters(content: string) {
  return Array.from(content || "").length;
}

async function saveDreamAudio(userId: string, audio: string) {
  if (!audio.startsWith("data:audio")) return null;

  const matches = audio.match(/^data:audio\/(\w+);base64,(.+)$/);
  if (!matches) return null;

  const audioDir = join(__dirname, "../../public/uploads/audio");
  if (!existsSync(audioDir)) {
    mkdirSync(audioDir, { recursive: true });
  }

  const filename = `dream-${userId}-${Date.now()}.${matches[1]}`;
  const filepath = join(audioDir, filename);
  await writeFile(filepath, Buffer.from(matches[2], "base64"));
  return `/uploads/audio/${filename}`;
}

const requestInclude = {
  plan: {
    select: {
      id: true,
      name: true,
      letterQuota: true,
      supportsVoiceNotes: true,
      voiceNoteMaxSeconds: true,
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
} satisfies Prisma.RequestInclude;

function formatDream(dream: any) {
  const request = dream.requests?.[0] ?? dream.request ?? null;
  const { requests, request: _request, ...rest } = dream;

  return {
    ...rest,
    content: rest.description,
    status: request?.status ?? "draft",
    interpreterId: request?.interpreterId ?? null,
    interpreter: request?.interpreter ?? null,
    plan: request?.plan ?? null,
    request,
  };
}

async function getUserRole(userId: string) {
  const profile = await prisma.profile.findFirst({
    where: { id: userId, deletedAt: null },
    select: { role: true },
  });
  return profile?.role ?? null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = await getUserRole(userId);

    if (!role) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const requestWhere =
      role === "dreamer"
        ? { dreamerId: userId }
        : role === "interpreter"
          ? { OR: [{ interpreterId: userId }, { interpreterId: null }] }
          : {};

    const dreams = await prisma.dream.findMany({
      where:
        role === "admin" || role === "super_admin"
          ? { deletedAt: null }
          : { deletedAt: null, requests: { some: requestWhere } },
      orderBy: { createdAt: "desc" },
      include: {
        dreamer: {
          select: { id: true, fullName: true, email: true, avatarUrl: true },
        },
        requests: {
          where: requestWhere,
          orderBy: { createdAt: "desc" },
          take: 1,
          include: requestInclude,
        },
      },
    });

    return res.json(dreams.map(formatDream));
  } catch (error) {
    console.error("[Dreams] Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch dreams" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const {
      title,
      description,
      dream_date,
      mood,
      metadata,
      planId,
      submissionType,
      dreamDescriptionText,
      dreamDescriptionAudioUrl,
      dreamDescriptionAudio,
    } = req.body ?? {};

    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    const normalizedSubmissionType =
      submissionType === "audio" ? "audio" : submissionType === "text" ? "text" : null;
    const textValue =
      typeof dreamDescriptionText === "string"
        ? dreamDescriptionText.trim()
        : typeof description === "string"
          ? description.trim()
          : "";

    if (!normalizedTitle || !planId || !normalizedSubmissionType) {
      return res.status(400).json({
        error: "title, planId, and submissionType are required",
      });
    }

    const profile = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    if (profile.role !== "dreamer" && profile.role !== "admin" && profile.role !== "super_admin") {
      return res.status(403).json({ error: "Only dreamers can submit dreams" });
    }

    const plan = await prisma.plan.findFirst({
      where: { id: planId, isActive: true, deletedAt: null },
    });

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    let audioUrl =
      typeof dreamDescriptionAudioUrl === "string" && dreamDescriptionAudioUrl.trim()
        ? dreamDescriptionAudioUrl.trim()
        : null;

    if (normalizedSubmissionType === "audio") {
      if (!plan.supportsVoiceNotes || !plan.voiceNoteMaxSeconds) {
        return res.status(400).json({ error: "This plan does not support voice notes" });
      }

      if (!audioUrl && typeof dreamDescriptionAudio === "string") {
        audioUrl = await saveDreamAudio(userId, dreamDescriptionAudio);
      }

      if (!audioUrl) {
        return res.status(400).json({ error: "Audio description is required" });
      }
    } else {
      if (!textValue) {
        return res.status(400).json({ error: "Dream description is required" });
      }

      if (countLetters(textValue) > plan.letterQuota) {
        return res.status(400).json({
          error: `Dream description exceeds plan letter quota of ${plan.letterQuota}`,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const dream = await tx.dream.create({
        data: {
          dreamerId: userId,
          title: normalizedTitle,
          description: normalizedSubmissionType === "text" ? textValue : normalizedTitle,
          dreamDate: dream_date ? new Date(dream_date) : null,
          mood: typeof mood === "string" && mood.trim() ? mood.trim() : null,
          metadata: metadata ?? {},
        },
      });

      const request = await tx.request.create({
        data: {
          dreamId: dream.id,
          dreamerId: userId,
          planId,
          submissionType: normalizedSubmissionType as SubmissionType,
          dreamDescriptionText:
            !bypassPaymentGateway && normalizedSubmissionType === "text" ? textValue : null,
          dreamDescriptionAudioUrl:
            !bypassPaymentGateway && normalizedSubmissionType === "audio" ? audioUrl : null,
          status: bypassPaymentGateway ? "paid" : "draft",
        },
      });

      if (bypassPaymentGateway) {
        await tx.requestPlanPurchase.create({
          data: {
            requestId: request.id,
            planId,
            submissionType: normalizedSubmissionType as SubmissionType,
            letterQuota: plan.letterQuota,
            lettersUsed: 0,
            voiceNoteMaxSeconds:
              normalizedSubmissionType === "audio" ? plan.voiceNoteMaxSeconds : null,
          },
        });

        await tx.chatMessage.create({
          data: {
            requestId: request.id,
            senderId: userId,
            content: normalizedSubmissionType === "text" ? textValue : null,
            messageType: normalizedSubmissionType as SubmissionType,
            audioUrl: normalizedSubmissionType === "audio" ? audioUrl : null,
          },
        });
      }

      const requestWithRelations = await tx.request.findUniqueOrThrow({
        where: { id: request.id },
        include: requestInclude,
      });

      return { ...dream, requests: [requestWithRelations] };
    });

    return res.status(201).json(formatDream(result));
  } catch (error) {
    console.error("[Dreams] Create error:", error);
    return res.status(500).json({ error: "Failed to create dream" });
  }
});

router.get("/stats", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = await getUserRole(userId);

    if (!role) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const where =
      role === "dreamer"
        ? { dreamerId: userId }
        : role === "interpreter"
          ? { OR: [{ interpreterId: userId }, { interpreterId: null }] }
          : {};

    const requests = await prisma.request.findMany({
      where: { ...where, dream: { deletedAt: null } },
      select: { status: true },
    });

    return res.json({
      total: requests.length,
      draft: requests.filter((request) => request.status === "draft").length,
      pending_payment: requests.filter((request) => request.status === "pending_payment").length,
      paid: requests.filter((request) => request.status === "paid").length,
      open: requests.filter((request) => request.status === "open").length,
      in_progress: requests.filter((request) => request.status === "in_progress").length,
      closed: requests.filter((request) => request.status === "closed").length,
      cancelled: requests.filter((request) => request.status === "cancelled").length,
    });
  } catch (error) {
    console.error("[Dreams] Stats error:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/featured", async (_req, res) => {
  try {
    const dreams = await prisma.dream.findMany({
      where: { isFeatured: true, deletedAt: null },
      orderBy: [{ featuredAt: "desc" }, { createdAt: "desc" }],
      take: 12,
      select: {
        id: true,
        title: true,
        description: true,
        createdAt: true,
        featuredAt: true,
      },
    });

    return res.json({
      dreams: dreams.map((dream) => ({
        ...dream,
        preview: dream.description,
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
    const role = await getUserRole(userId);
    const isAdmin = role === "admin" || role === "super_admin";

    const dream = await prisma.dream.findFirst({
      where: { id, deletedAt: null },
      include: {
        dreamer: {
          select: { id: true, fullName: true, email: true, avatarUrl: true },
        },
        requests: {
          take: 1,
          include: requestInclude,
        },
      },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const request = dream.requests[0] ?? null;
    const hasAccess =
      isAdmin ||
      dream.dreamerId === userId ||
      request?.interpreterId === userId;

    if (!hasAccess) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(formatDream(dream));
  } catch (error) {
    console.error("[Dreams] Fetch single error:", error);
    return res.status(500).json({ error: "Failed to fetch dream" });
  }
});

router.patch("/:id/feature", requireAuth, async (req, res) => {
  try {
    const role = await getUserRole(req.user!.userId);
    if (role !== "admin" && role !== "super_admin") {
      return res.status(403).json({ error: "Forbidden - Admin access required" });
    }

    const updated = await prisma.dream.update({
      where: { id: req.params.id },
      data: {
        isFeatured: Boolean(req.body?.isFeatured),
        featuredAt: req.body?.isFeatured ? new Date() : null,
      },
      include: {
        dreamer: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        requests: { take: 1, include: requestInclude },
      },
    });

    return res.json({ dream: formatDream(updated) });
  } catch (error) {
    console.error("[Dreams] Feature update error:", error);
    return res.status(500).json({ error: "Failed to update featured dream" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { status, interpreter_id } = req.body ?? {};
    const role = await getUserRole(userId);
    const isAdmin = role === "admin" || role === "super_admin";

    const dream = await prisma.dream.findFirst({
      where: { id, deletedAt: null },
      include: {
        requests: { take: 1, include: requestInclude },
      },
    });

    if (!dream || !dream.requests[0]) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const request = dream.requests[0];
    const isAssignedInterpreter = role === "interpreter" && request.interpreterId === userId;
    const updateData: Prisma.RequestUpdateInput = {};

    if (interpreter_id) {
      if (!isAdmin) {
        return res.status(403).json({ error: "Only admins can assign interpreters" });
      }
      updateData.interpreter = { connect: { id: interpreter_id } };
      updateData.status = "in_progress";
    }

    if (status) {
      if (!isAdmin && !isAssignedInterpreter) {
        return res.status(403).json({ error: "Only admins or assigned interpreters can update request status" });
      }
      updateData.status = status;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    await prisma.request.update({
      where: { id: request.id },
      data: updateData,
    });

    const updated = await prisma.dream.findFirst({
      where: { id, deletedAt: null },
      include: {
        dreamer: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        requests: { take: 1, include: requestInclude },
      },
    });

    return res.json(formatDream(updated));
  } catch (error) {
    console.error("[Dreams] Update error:", error);
    return res.status(500).json({ error: "Failed to update dream" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = await getUserRole(userId);
    const isAdmin = role === "admin" || role === "super_admin";

    const dream = await prisma.dream.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    if (dream.dreamerId !== userId && !isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await prisma.dream.update({
      where: { id: req.params.id },
      data: { isFeatured: false, featuredAt: null, deletedAt: new Date() },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Dreams] Delete error:", error);
    return res.status(500).json({ error: "Failed to delete dream" });
  }
});

export default router;
