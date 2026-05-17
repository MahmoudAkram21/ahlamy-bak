import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { optionalAuth, requireAuth } from "../middleware/auth";
import { normalizePlanName } from "../utils/planText";

const router = Router();

const planScopes = ["egypt", "international", "custom"] as const;

function parseCountryCodes(value: unknown): string[] {
  let parsedValue = value;
  if (typeof value === "string") {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = [];
    }
  }
  if (!Array.isArray(parsedValue)) return [];
  return parsedValue
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter((item) => /^[A-Z]{2}$/.test(item));
}

function normalizeScope(value: unknown) {
  return typeof value === "string" && planScopes.includes(value as any)
    ? (value as (typeof planScopes)[number])
    : null;
}

function matchesCountry(plan: any, country?: string) {
  const normalizedCountry = country?.trim().toUpperCase();
  if (!normalizedCountry) return true;
  if (normalizedCountry === "OTHER" || normalizedCountry === "OUTSIDE_EGYPT") {
    return plan.scope === "international";
  }

  if (plan.scope === "egypt") return normalizedCountry === "EG";
  if (plan.scope === "international") return normalizedCountry !== "EG";
  if (plan.scope === "custom") return parseCountryCodes(plan.countryCodes).includes(normalizedCountry);

  return true;
}

function formatPlan(plan: any) {
  return {
    id: plan.id,
    name: normalizePlanName(plan.name),
    description: plan.description,
    price: Number(plan.price),
    currency: plan.currency,
    letterQuota: plan.letterQuota,
    features: Array.isArray(plan.features)
      ? plan.features
      : plan.features
      ? JSON.parse(plan.features)
      : [],
    scope: plan.scope,
    countryCodes: parseCountryCodes(plan.countryCodes),
    isActive: plan.isActive,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

router.get("/", optionalAuth, async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === "true";
    const country = typeof req.query.country === "string" ? req.query.country : undefined;
    const requesterRole = req.user?.role;

    const isElevated =
      requesterRole === "admin" || requesterRole === "super_admin";

    const plans = await prisma.plan.findMany({
      where: includeInactive && isElevated ? {} : { isActive: true },
      orderBy: { price: "asc" },
    });

    const filteredPlans = includeInactive && isElevated ? plans : plans.filter((plan) => matchesCountry(plan, country));

    return res.json({ plans: filteredPlans.map(formatPlan) });
  } catch (error) {
    console.error("[Plans] Fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch plans" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden - Admin access required" });
    }

    const {
      name,
      description,
      price,
      currency,
      letterQuota,
      features,
      scope = "egypt",
      countryCodes = [],
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

    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) {
      return res.status(400).json({ error: "Invalid plan scope" });
    }

    const normalizedCountryCodes =
      normalizedScope === "custom" ? parseCountryCodes(countryCodes) : [];

    const plan = await prisma.plan.create({
      data: {
        name,
        description,
        price: new Prisma.Decimal(price),
        currency: currency.toUpperCase(),
        letterQuota: Number(letterQuota),
        features: features ?? [],
        scope: normalizedScope,
        countryCodes: normalizedCountryCodes,
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
    if (req.user!.role !== "admin" && req.user!.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden - Admin access required" });
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
      scope,
      countryCodes,
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
    if (scope !== undefined) {
      const normalizedScope = normalizeScope(scope);
      if (!normalizedScope) {
        return res.status(400).json({ error: "Invalid plan scope" });
      }
      updateData.scope = normalizedScope;
      if (normalizedScope !== "custom" && countryCodes === undefined) {
        updateData.countryCodes = [];
      }
    }
    if (countryCodes !== undefined) {
      const nextScope = (updateData.scope || existingPlan.scope) as string;
      updateData.countryCodes = nextScope === "custom" ? parseCountryCodes(countryCodes) : [];
    }
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

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    if (req.user!.role !== "admin" && req.user!.role !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Forbidden - Admin access required" });
    }

    const { id } = req.params;

    const existingPlan = await prisma.plan.findUnique({ where: { id } });

    if (!existingPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const [payments, dreams, userPlans, dreamPurchases] = await Promise.all([
      prisma.payment.count({ where: { planId: id } }),
      prisma.dream.count({ where: { planId: id } }),
      prisma.userPlan.count({ where: { planId: id } }),
      prisma.dreamPlanPurchase.count({ where: { planId: id } }),
    ]);

    if (payments || dreams || userPlans || dreamPurchases) {
      return res.status(409).json({
        error: "Plan has related records. Deactivate it instead of deleting it.",
      });
    }

    await prisma.plan.delete({ where: { id } });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Plans] Delete error:", error);
    return res.status(500).json({ error: "Failed to delete plan" });
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
