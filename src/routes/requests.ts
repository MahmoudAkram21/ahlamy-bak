import { Router } from "express";
import { Prisma, RequestStatus, SubmissionType } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { createNotification } from "../utils/notifications";

const router = Router();

const requestInclude = {
  dream: {
    select: {
      id: true,
      title: true,
      description: true,
      createdAt: true,
    },
  },
  plan: {
    select: {
      id: true,
      name: true,
      letterQuota: true,
      supportsVoiceNotes: true,
      voiceNoteMaxSeconds: true,
    },
  },
  dreamer: {
    select: { id: true, fullName: true, email: true, avatarUrl: true },
  },
  interpreter: {
    select: { id: true, fullName: true, email: true, avatarUrl: true },
  },
  planPurchase: true,
} satisfies Prisma.RequestInclude;

function formatRequest(request: any) {
  return {
    ...request,
    title: request.dream?.title,
    description: request.dream?.description,
    dream: request.dream
      ? {
          ...request.dream,
          content: request.dream.description,
          plan: request.plan ?? null,
        }
      : null,
  };
}

function normalizeStatus(value: unknown) {
  const allowed: RequestStatus[] = ["draft", "pending_payment", "paid", "open", "in_progress", "closed", "cancelled"];
  return typeof value === "string" && allowed.includes(value as RequestStatus)
    ? (value as RequestStatus)
    : null;
}

function normalizeSubmissionType(value: unknown) {
  return value === "text" || value === "audio" ? (value as SubmissionType) : null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const profile = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });

    const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
    const status = normalizeStatus(req.query.status);

    const requests = await prisma.request.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(isAdmin ? {} : { OR: [{ dreamerId: userId }, { interpreterId: userId }] }),
        dream: { deletedAt: null },
      },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
    });

    return res.json(requests.map(formatRequest));
  } catch (error) {
    console.error("[Requests] Fetch error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { dreamId, planId, submissionType, dreamDescriptionText, dreamDescriptionAudioUrl } = req.body ?? {};

    if (!dreamId || !planId) {
      return res.status(400).json({ error: "dreamId and planId are required" });
    }

    const dream = await prisma.dream.findFirst({
      where: { id: dreamId, dreamerId: userId, deletedAt: null },
      select: { id: true, dreamerId: true },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    const normalizedSubmissionType = normalizeSubmissionType(submissionType);

    const request = await prisma.request.create({
      data: {
        dreamId,
        dreamerId: userId,
        planId,
        submissionType: normalizedSubmissionType,
        dreamDescriptionText: normalizedSubmissionType === "text" ? dreamDescriptionText ?? null : null,
        dreamDescriptionAudioUrl: normalizedSubmissionType === "audio" ? dreamDescriptionAudioUrl ?? null : null,
        status: "draft",
      },
      include: requestInclude,
    });

    return res.status(201).json(formatRequest(request));
  } catch (error) {
    console.error("[Requests] Create error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const request = await prisma.request.findFirst({
      where: { id: req.params.id, dream: { deletedAt: null } },
      include: requestInclude,
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    const profile = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true },
    });
    const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

    if (!isAdmin && request.dreamerId !== userId && request.interpreterId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json(formatRequest(request));
  } catch (error) {
    console.error("[Requests] Fetch single error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const requesterId = req.user!.userId;
    const { status, interpreterId, submissionType, dreamDescriptionText, dreamDescriptionAudioUrl } = req.body ?? {};

    const existingRequest = await prisma.request.findFirst({
      where: { id: req.params.id, dream: { deletedAt: null } },
      select: {
        id: true,
        dreamerId: true,
        interpreterId: true,
        status: true,
      },
    });

    if (!existingRequest) {
      return res.status(404).json({ error: "Request not found" });
    }

    const profile = await prisma.profile.findFirst({
      where: { id: requesterId, deletedAt: null },
      select: { role: true },
    });

    const role = profile?.role;
    const isSuperAdmin = role === "super_admin";
    const isAdmin = role === "admin";
    const isDreamer = existingRequest.dreamerId === requesterId;
    const isInterpreter = existingRequest.interpreterId === requesterId;

    if (!isSuperAdmin && !isAdmin && !isDreamer && !isInterpreter) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updateData: Prisma.RequestUpdateInput = {};

    if (interpreterId) {
      if (!isAdmin && !isSuperAdmin) {
        return res.status(403).json({ error: "Only admins can assign interpreters" });
      }
      updateData.interpreter = { connect: { id: interpreterId } };
      updateData.status = "in_progress";
    }

    const nextStatus = normalizeStatus(status);
    if (status && !nextStatus) {
      return res.status(400).json({ error: "Invalid request status" });
    }

    if (nextStatus) {
      const isClosingOrReopening =
        nextStatus === "closed" ||
        (existingRequest.status === "closed" && ["open", "in_progress"].includes(nextStatus));

      if (isClosingOrReopening && !isSuperAdmin && !isAdmin && !isInterpreter) {
        return res.status(403).json({ error: "Only the assigned interpreter or an admin can close or reopen requests" });
      }

      if (!isClosingOrReopening && !isSuperAdmin && !isAdmin && !isDreamer && !isInterpreter) {
        return res.status(403).json({ error: "You cannot update this request status" });
      }

      updateData.status = nextStatus;
    }

    const nextSubmissionType = normalizeSubmissionType(submissionType);
    if (submissionType !== undefined) {
      if (!isDreamer || !["draft", "pending_payment"].includes(existingRequest.status)) {
        return res.status(403).json({ error: "Only the dreamer can edit draft request submission details" });
      }
      if (!nextSubmissionType) {
        return res.status(400).json({ error: "Invalid submission type" });
      }
      updateData.submissionType = nextSubmissionType;
    }

    if (dreamDescriptionText !== undefined || dreamDescriptionAudioUrl !== undefined) {
      if (!isDreamer || !["draft", "pending_payment"].includes(existingRequest.status)) {
        return res.status(403).json({ error: "Only the dreamer can edit draft request details" });
      }
      if (dreamDescriptionText !== undefined) updateData.dreamDescriptionText = dreamDescriptionText || null;
      if (dreamDescriptionAudioUrl !== undefined) updateData.dreamDescriptionAudioUrl = dreamDescriptionAudioUrl || null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    const updatedRequest = await prisma.request.update({
      where: { id: existingRequest.id },
      data: updateData,
      include: requestInclude,
    });

    if (interpreterId && interpreterId !== existingRequest.interpreterId) {
      Promise.all([
        createNotification(
          existingRequest.dreamerId,
          "request_assigned",
          "Your request has been assigned to an interpreter",
          existingRequest.id,
        ),
        createNotification(
          interpreterId,
          "request_assigned",
          "A new request has been assigned to you",
          existingRequest.id,
        ),
      ]).catch((error) => console.error("[Notifications] Request assignment trigger error:", error));
    }

    if (nextStatus && nextStatus !== existingRequest.status) {
      const recipientIds = [existingRequest.dreamerId, existingRequest.interpreterId].filter(
        (recipientId): recipientId is string => Boolean(recipientId && recipientId !== requesterId),
      );

      Promise.all(
        recipientIds.map((recipientId) =>
          createNotification(
            recipientId,
            "request_status_changed",
            `Request status changed to ${nextStatus}`,
            existingRequest.id,
          ),
        ),
      ).catch((error) => console.error("[Notifications] Request status trigger error:", error));
    }

    return res.json(formatRequest(updatedRequest));
  } catch (error) {
    console.error("[Requests] Update error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
