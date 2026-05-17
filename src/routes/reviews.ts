import { Router } from "express";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { normalizeReviewText } from "../utils/reviewText";

const router = Router();

router.get("/featured", async (_req, res) => {
  try {
    const reviews = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        id,
        reviewer_name AS reviewerName,
        content,
        rating,
        source,
        created_at AS createdAt
      FROM reviews
      WHERE is_featured = true AND is_published = true
      ORDER BY created_at DESC
      LIMIT 12
    `);

    return res.json({ reviews: reviews.map((review) => normalizeReviewText(review)) });
  } catch (error) {
    console.error("[Reviews] Featured fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const reviews = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        id,
        reviewer_name AS reviewerName,
        content,
        rating,
        source,
        is_featured AS isFeatured,
        created_at AS createdAt
      FROM reviews
      WHERE is_published = true
      ORDER BY is_featured DESC, created_at DESC
    `);

    return res.json({
      reviews: reviews.map((review) =>
        normalizeReviewText({
          ...review,
          isFeatured: Boolean(review.isFeatured),
        })
      ),
    });
  } catch (error) {
    console.error("[Reviews] Published fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const rating = Number(req.body?.rating);
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    }

    if (content.length < 10) {
      return res.status(400).json({ error: "Review content is too short" });
    }

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const id = randomUUID();
    const reviewerName = profile.fullName || profile.email.split("@")[0] || "مستخدم أحلامي";
    const now = new Date();

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO reviews (
        id,
        reviewer_name,
        content,
        rating,
        source,
        is_featured,
        is_published,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${reviewerName},
        ${content},
        ${rating},
        ${"app"},
        ${false},
        ${false},
        ${now},
        ${now}
      )
    `);

    return res.status(201).json({
      review: {
        id,
        reviewerName,
        content,
        rating,
        source: "app",
        isFeatured: false,
        isPublished: false,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (error) {
    console.error("[Reviews] Create error:", error);
    return res.status(500).json({ error: "Failed to create review" });
  }
});

export default router;
