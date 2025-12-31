import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import stripe from "../lib/stripe";
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

const router = Router();

// Create Stripe checkout session for a specific dream
router.post("/purchase-for-dream", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error: "Payment system not configured. Please contact administrator.",
      });
    }

    const userId = req.user!.userId;
    const { dreamId, planId } = req.body;

    if (!dreamId || !planId) {
      return res.status(400).json({ error: "dreamId and planId are required" });
    }

    // Verify dream exists and belongs to user
    const dream = await prisma.dream.findUnique({
      where: { id: dreamId },
      select: {
        id: true,
        dreamerId: true,
        status: true,
        description: true,
      },
    });

    if (!dream) {
      return res.status(404).json({ error: "Dream not found" });
    }

    if (dream.dreamerId !== userId) {
      return res
        .status(403)
        .json({ error: "You can only purchase plans for your own dreams" });
    }

    if (dream.status !== "pending_payment") {
      return res.status(400).json({
        error: `Dream is not in pending_payment status. Current status: ${dream.status}`,
      });
    }

    // Get plan details
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    if (!plan.isActive) {
      return res.status(400).json({ error: "This plan is not available" });
    }

    // Check if plan covers the dream's letter count
    const letterCount = Array.from(dream.description || "").length;
    if (plan.letterQuota !== null && plan.letterQuota < letterCount) {
      return res.status(400).json({
        error: `This plan (${plan.letterQuota} letters) does not cover your dream (${letterCount} letters). Please choose a plan with at least ${letterCount} letters.`,
      });
    }

    // Get user details
    const user = await prisma.profile.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: plan.currency.toLowerCase(),
            product_data: {
              name: plan.name,
              description:
                plan.description ||
                `Plan for dream: ${dreamId.substring(0, 8)}...`,
            },
            unit_amount: Math.round(Number(plan.price) * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&dreamId=${dreamId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel?dreamId=${dreamId}`,
      metadata: {
        userId: userId,
        planId: plan.id,
        dreamId: dreamId,
        letterQuota: plan.letterQuota.toString(),
        purchaseType: "dream", // Distinguish from subscription purchases
      },
    });

    return res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("[Payments] Purchase for dream error:", error);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Create Stripe checkout session (for subscription - legacy)
router.post("/create-checkout-session", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error: "Payment system not configured. Please contact administrator.",
      });
    }

    const userId = req.user!.userId;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: "planId is required" });
    }

    // Get plan details
    const plan = await prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    if (!plan.isActive) {
      return res.status(400).json({ error: "This plan is not available" });
    }

    // Get user details
    const user = await prisma.profile.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: plan.currency.toLowerCase(),
            product_data: {
              name: plan.name,
              description: plan.description || undefined,
            },
            unit_amount: Math.round(Number(plan.price) * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment", // One-time payment (can change to 'subscription' later)
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment/cancel`,
      metadata: {
        userId: userId,
        planId: plan.id,
        durationDays: plan.durationDays.toString(),
      },
    });

    return res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("[Payments] Checkout session error:", error);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Stripe webhook handler
router.post("/webhook", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "Payment system not configured" });
  }

  const sig = req.headers["stripe-signature"];

  if (!sig) {
    return res.status(400).json({ error: "No signature header" });
  }

  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error(
      "[Payments] Webhook signature verification failed:",
      err.message
    );
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log("[Payments] Webhook event received:", event.type);

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const { userId, planId, dreamId, letterQuota, purchaseType } =
          session.metadata;

        console.log(
          "[Payments] Processing completed session for user:",
          userId,
          "purchaseType:",
          purchaseType
        );

        // Handle per-dream purchase
        if (purchaseType === "dream" && dreamId) {
          await prisma.$transaction(async (tx) => {
            // Create payment record with dreamId
            const payment = await tx.payment.create({
              data: {
                userId: userId,
                planId: planId,
                dreamId: dreamId,
                amount: new Prisma.Decimal(session.amount_total / 100),
                currency: session.currency.toUpperCase(),
                status: "succeeded",
                provider: "stripe",
                reference: session.id,
                paidAt: new Date(),
                metadata: {
                  sessionId: session.id,
                  customerEmail: session.customer_email,
                  purchaseType: "dream",
                },
              },
            });

            // Create DreamPlanPurchase record
            await tx.dreamPlanPurchase.create({
              data: {
                dreamId: dreamId,
                planId: planId,
                paymentId: payment.id,
                letterQuota: parseInt(letterQuota || "0", 10),
                lettersUsed: 0,
              },
            });

            // Update dream status from pending_payment to new
            await tx.dream.update({
              where: { id: dreamId },
              data: {
                status: "new",
                planId: planId, // Link dream to plan
              },
            });
          });

          console.log(
            "[Payments] Dream plan purchase completed for dream:",
            dreamId
          );
          break;
        }

        // Handle subscription purchase (legacy)
        const { durationDays } = session.metadata;
        if (durationDays) {
          // Calculate expiration date
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + parseInt(durationDays));

          // Create payment record and activate subscription in transaction
          await prisma.$transaction(async (tx) => {
            // Create payment record
            await tx.payment.create({
              data: {
                userId: userId,
                planId: planId,
                amount: new Prisma.Decimal(session.amount_total / 100),
                currency: session.currency.toUpperCase(),
                status: "succeeded",
                provider: "stripe",
                reference: session.id,
                paidAt: new Date(),
                metadata: {
                  sessionId: session.id,
                  customerEmail: session.customer_email,
                },
              },
            });

            // Activate or update subscription
            await tx.userPlan.upsert({
              where: {
                userId_planId: {
                  userId: userId,
                  planId: planId,
                },
              },
              create: {
                userId: userId,
                planId: planId,
                isActive: true,
                expiresAt: expiresAt,
                lettersUsed: 0,
                audioMinutesUsed: 0,
              },
              update: {
                isActive: true,
                expiresAt: expiresAt,
                lettersUsed: 0,
                audioMinutesUsed: 0,
                startedAt: new Date(),
              },
            });

            // Update user's current plan
            await tx.profile.update({
              where: { id: userId },
              data: { currentPlanId: planId },
            });
          });

          console.log("[Payments] Subscription activated for user:", userId);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        console.error("[Payments] Payment failed:", paymentIntent.id);
        // You can add logic to notify the user here
        break;
      }

      default:
        console.log("[Payments] Unhandled event type:", event.type);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("[Payments] Webhook processing error:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

// Get payment history for current user
router.get("/history", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    const payments = await prisma.payment.findMany({
      where: { userId },
      include: {
        plan: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      payments: payments.map((payment) => ({
        id: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        reference: payment.reference,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        plan: payment.plan
          ? {
              id: payment.plan.id,
              name: payment.plan.name,
              description: payment.plan.description,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error("[Payments] History fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch payment history" });
  }
});

export default router;
