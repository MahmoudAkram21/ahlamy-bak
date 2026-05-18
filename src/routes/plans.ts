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
    supportsVoiceNotes: Boolean(plan.supportsVoiceNotes),
    voiceNoteMaxSeconds: plan.voiceNoteMaxSeconds,
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
      where: includeInactive && isElevated ? { deletedAt: null } : { isActive: true, deletedAt: null },
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
      supportsVoiceNotes = false,
      voiceNoteMaxSeconds,
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
    const normalizedVoiceMax =
      voiceNoteMaxSeconds === undefined || voiceNoteMaxSeconds === null || voiceNoteMaxSeconds === ""
        ? null
        : Number(voiceNoteMaxSeconds);

    if (Boolean(supportsVoiceNotes) && (normalizedVoiceMax === null || !Number.isFinite(normalizedVoiceMax) || normalizedVoiceMax <= 0)) {
      return res.status(400).json({ error: "voiceNoteMaxSeconds is required when voice notes are enabled" });
    }

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
        supportsVoiceNotes: Boolean(supportsVoiceNotes),
        voiceNoteMaxSeconds: Boolean(supportsVoiceNotes) ? normalizedVoiceMax : null,
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

    const existingPlan = await prisma.plan.findFirst({ where: { id, deletedAt: null } });

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
      supportsVoiceNotes,
      voiceNoteMaxSeconds,
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
    if (supportsVoiceNotes !== undefined) {
      updateData.supportsVoiceNotes = Boolean(supportsVoiceNotes);
      if (!Boolean(supportsVoiceNotes) && voiceNoteMaxSeconds === undefined) {
        updateData.voiceNoteMaxSeconds = null;
      }
    }
    if (voiceNoteMaxSeconds !== undefined) {
      updateData.voiceNoteMaxSeconds =
        voiceNoteMaxSeconds === null || voiceNoteMaxSeconds === "" ? null : Number(voiceNoteMaxSeconds);
    }

    const nextSupportsVoice = (updateData.supportsVoiceNotes ?? existingPlan.supportsVoiceNotes) as boolean;
    const nextVoiceMax = (updateData.voiceNoteMaxSeconds ?? existingPlan.voiceNoteMaxSeconds) as number | null;
    if (nextSupportsVoice && (!Number.isFinite(Number(nextVoiceMax)) || Number(nextVoiceMax) <= 0)) {
      return res.status(400).json({ error: "voiceNoteMaxSeconds is required when voice notes are enabled" });
    }

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

    const existingPlan = await prisma.plan.findFirst({ where: { id, deletedAt: null } });

    if (!existingPlan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    await prisma.plan.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("[Plans] Delete error:", error);
    return res.status(500).json({ error: "Failed to delete plan" });
  }
});

router.post("/subscribe", requireAuth, async (req, res) => {
  return res.status(410).json({
    error: "Plan subscriptions are no longer supported. Create a dream request and pay for that request instead.",
  });
});

export default router;
