import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { optionalAuth, requireAuth } from "../middleware/auth";

const router = Router();

function formatPlan(plan: any) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: Number(plan.price),
    currency: plan.currency,
    letterQuota: plan.letterQuota,
    features: Array.isArray(plan.features)
      ? plan.features
      : plan.features
      ? JSON.parse(plan.features)
      : [],
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

router.get("/", optionalAuth, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const requesterRole = req.user?.role;

    const isElevated =
      requesterRole === "admin" || requesterRole === "super_admin";

    const plans = await prisma.plan.findMany({
      where: includeInactive && isElevated ? {} : { isActive: true },
      orderBy: { price: "asc" },
    });

    return res.json({ plans: plans.map(formatPlan) });
  } catch (error) {
    console.error("[Plans] Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch plans" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden - Super admin access required" });
    }

    const {
      name,
      description,
      price,
      currency,
      letterQuota,
      features,
      isActive = true,
    } = req.body ?? {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Plan name is required" });
    }

    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: "Valid plan price is required" });
    }

    if (!currency || typeof currency !== "string") {
      return res.status(400).json({ error: "Plan currency is required" });
    }

    if (letterQuota === undefined || letterQuota === null || Number.isNaN(Number(letterQuota))) {
      return res.status(400).json({ error: "Plan letterQuota is required" });
    }

    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        price: new Prisma.Decimal(price),
        currency: currency.toUpperCase(),
        letterQuota: Number(letterQuota),
        features: features ?? [],
        isActive: Boolean(isActive),
      },
    });

    return res.status(201).json({ plan: formatPlan(plan) });
  } catch (error) {
    console.error("[Plans] Create error:", error);
    return res.status(500).json({ error: "Failed to create plan" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden - Super admin access required" });
    }

    const { id } = req.params;

    const existingPlan = await prisma.plan.findUnique({ where: { id } });

    if (!existingPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const {
      name,
      description,
      price,
      currency,
      letterQuota,
      features,
      isActive,
    } = req.body ?? {};

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined && !Number.isNaN(Number(price))) {
      updateData.price = new Prisma.Decimal(price);
    }
    if (currency !== undefined) updateData.currency = currency.toUpperCase();
    if (letterQuota !== undefined && !Number.isNaN(Number(letterQuota))) {
      updateData.letterQuota = Number(letterQuota);
    }
    if (features !== undefined) updateData.features = features;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    const plan = await prisma.plan.update({
      where: { id },
      data: updateData,
    });

    return res.json({ plan: formatPlan(plan) });
  } catch (error) {
    console.error("[Plans] Update error:", error);
    return res.status(500).json({ error: "Failed to update plan" });
  }
});

router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { planId } = req.body ?? {};

    if (!planId) {
      return res.status(400).json({ error: "planId is required" });
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    // Note: Legacy subscription endpoint - plans are now purchased per-dream
    // This endpoint is kept for backward compatibility but may not work as expected
    // since plans no longer have durationDays
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // Default to 1 year

    const subscription = await prisma.$transaction(async (tx) => {
      const upserted = await tx.userPlan.upsert({
        where: {
          userId_planId: {
            userId,
            planId,
          },
        },
        create: {
          userId,
          planId,
          expiresAt,
          isActive: true,
          lettersUsed: 0,
          audioMinutesUsed: 0,
        },
        update: {
          expiresAt,
          isActive: true,
          lettersUsed: 0,
          audioMinutesUsed: 0,
        },
        include: {
          plan: true,
        },
      });

      await tx.profile.update({
        where: { id: userId },
        data: { currentPlanId: planId },
      });

      await tx.payment.create({
        data: {
          userId,
          planId,
          amount: plan.price,
          currency: plan.currency,
          status: "succeeded",
          provider: "manual",
          reference: `SUB-${Date.now()}`,
        },
      });

      return upserted;
    });

    return res.json({
      subscription: { ...subscription, plan: formatPlan(subscription.plan) },
    });
  } catch (error) {
    console.error("[Plans] Subscribe error:", error);
    return res.status(500).json({ error: "Failed to subscribe to plan" });
  }
});

export default router;
