import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth } from "../middleware/auth";
import stripe from "../lib/stripe";
import prisma from "../lib/prisma";
import { appBaseUrl } from "../config/urls";
import { createNotification } from "../utils/notifications";

const router = Router();

function toDecimalAmount(amountTotal?: number | null) {
  return new Prisma.Decimal((amountTotal ?? 0) / 100);
}

async function completeRequestPayment(tx: Prisma.TransactionClient, params: {
  requestId: string;
  paymentId?: string | null;
  sessionId: string;
  amountTotal?: number | null;
  currency?: string | null;
  customerEmail?: string | null;
}) {
  const request = await tx.request.findFirst({
    where: { id: params.requestId, dream: { deletedAt: null } },
    include: {
      plan: true,
      planPurchase: true,
      payments: {
        where: params.paymentId ? { id: params.paymentId } : { reference: params.sessionId },
        take: 1,
      },
    },
  });

  if (!request) {
    throw new Error("Request not found");
  }

  if (!request.planId || !request.plan || !request.submissionType) {
    throw new Error("Request is missing plan or submission type");
  }

  const payment =
    request.payments[0] ??
    (await tx.payment.create({
      data: {
        userId: request.dreamerId,
        planId: request.planId,
        requestId: request.id,
        amount: toDecimalAmount(params.amountTotal),
        currency: params.currency?.toUpperCase() || request.plan.currency,
        status: "pending",
        provider: "stripe",
        reference: params.sessionId,
        metadata: { sessionId: params.sessionId },
      },
    }));

  const paidAt = new Date();

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: "succeeded",
      paidAt,
      reference: params.sessionId,
      metadata: {
        ...(typeof payment.metadata === "object" && payment.metadata ? payment.metadata : {}),
        sessionId: params.sessionId,
        customerEmail: params.customerEmail,
      },
    },
  });

  if (!request.planPurchase) {
    await tx.requestPlanPurchase.create({
      data: {
        requestId: request.id,
        planId: request.planId,
        paymentId: payment.id,
        submissionType: request.submissionType,
        letterQuota: request.plan.letterQuota,
        lettersUsed: 0,
        voiceNoteMaxSeconds:
          request.submissionType === "audio" ? request.plan.voiceNoteMaxSeconds : null,
      },
    });
  }

  const firstMessageExists = await tx.chatMessage.findFirst({
    where: { requestId: request.id },
    select: { id: true },
  });

  if (!firstMessageExists) {
    if (request.dreamDescriptionAudioUrl) {
      await tx.chatMessage.create({
        data: {
          requestId: request.id,
          senderId: request.dreamerId,
          content: null,
          messageType: "audio",
          audioUrl: request.dreamDescriptionAudioUrl,
        },
      });
    } else if (request.dreamDescriptionText) {
      await tx.chatMessage.create({
        data: {
          requestId: request.id,
          senderId: request.dreamerId,
          content: request.dreamDescriptionText,
          messageType: "text",
        },
      });
    }
  }

  const updatedRequest = await tx.request.update({
    where: { id: request.id },
    data: {
      status: "paid",
      dreamDescriptionText: null,
      dreamDescriptionAudioUrl: null,
    },
    select: {
      id: true,
      dreamId: true,
      dreamerId: true,
      status: true,
    },
  });

  return { request: updatedRequest, paymentId: payment.id };
}

async function createCheckoutForRequest(userId: string, requestId: string) {
    const stripeClient = stripe;
    if (!stripeClient) {
      return { status: 503, body: { error: "Payment system not configured" } };
    }

    const request = await prisma.request.findFirst({
      where: { id: requestId, dreamerId: userId, dream: { deletedAt: null } },
      include: {
        plan: true,
        dream: { select: { id: true, title: true } },
      },
    });

    if (!request) {
      return { status: 404, body: { error: "Request not found" } };
    }

    if (!request.planId || !request.plan || !request.submissionType) {
      return { status: 400, body: { error: "Request must have a plan and submission type before payment" } };
    }

    if (request.submissionType === "text") {
      const description = request.dreamDescriptionText || "";
      if (!description.trim()) {
        return { status: 400, body: { error: "Dream description is required before payment" } };
      }
      if (Array.from(description).length > request.plan.letterQuota) {
        return { status: 400, body: { error: `Dream description exceeds plan letter quota of ${request.plan.letterQuota}` } };
      }
    }

    if (request.submissionType === "audio" && !request.dreamDescriptionAudioUrl) {
      return { status: 400, body: { error: "Audio description is required before payment" } };
    }

    const user = await prisma.profile.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true },
    });

    if (!user) {
      return { status: 404, body: { error: "User not found" } };
    }

    const payment = await prisma.$transaction(async (tx) => {
      await tx.request.update({
        where: { id: request.id },
        data: { status: "pending_payment" },
      });

      return tx.payment.create({
        data: {
          userId,
          planId: request.planId!,
          requestId: request.id,
          amount: request.plan!.price,
          currency: request.plan!.currency,
          status: "pending",
          provider: "stripe",
          metadata: { requestId: request.id },
        },
      });
    });

    const session = await stripeClient.checkout.sessions.create({
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: request.plan.currency.toLowerCase(),
            product_data: {
              name: request.plan.name,
              description: request.plan.description || `Request ${request.id}`,
            },
            unit_amount: Math.round(Number(request.plan.price) * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${appBaseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&requestId=${request.id}&dreamId=${request.dreamId}`,
      cancel_url: `${appBaseUrl}/payment/cancel?requestId=${request.id}&dreamId=${request.dreamId}`,
      metadata: {
        userId,
        planId: request.planId,
        requestId: request.id,
        paymentId: payment.id,
        purchaseType: "request",
      },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        reference: session.id,
        metadata: {
          requestId: request.id,
          sessionId: session.id,
          purchaseType: "request",
        },
      },
    });

    return { status: 200, body: { url: session.url, sessionId: session.id, requestId: request.id } };
}

router.post("/purchase-for-request", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: "Payment system not configured" });
    }

    const userId = req.user!.userId;
    const { requestId } = req.body ?? {};

    if (!requestId) {
      return res.status(400).json({ error: "requestId is required" });
    }

    const result = await createCheckoutForRequest(userId, requestId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[Payments] Request checkout error:", error);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/purchase-for-dream", requireAuth, async (req, res) => {
  try {
    const { dreamId } = req.body ?? {};
    if (!dreamId) {
      return res.status(400).json({ error: "dreamId is required" });
    }

    const request = await prisma.request.findFirst({
      where: { dreamId, dreamerId: req.user!.userId, dream: { deletedAt: null } },
      select: { id: true },
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found for dream" });
    }

    req.body.requestId = request.id;
    const result = await createCheckoutForRequest(req.user!.userId, request.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[Payments] Dream checkout compatibility error:", error);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

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
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[Payments] Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const requestId = session.metadata?.requestId;
      if (!requestId) {
        return res.json({ received: true });
      }

      const result = await prisma.$transaction((tx) =>
        completeRequestPayment(tx, {
          requestId,
          paymentId: session.metadata?.paymentId,
          sessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
          customerEmail: session.customer_email,
        }),
      );

      createNotification(
        result.request.dreamerId,
        "request_paid",
        "Your payment was confirmed",
        result.request.id,
      ).catch((error) => console.error("[Notifications] Payment notification error:", error));
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("[Payments] Webhook processing error:", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.get("/history", requireAuth, async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { userId: req.user!.userId },
      include: {
        plan: { select: { id: true, name: true, description: true } },
        request: { select: { id: true, dreamId: true } },
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
        request: payment.request,
        plan: payment.plan,
      })),
    });
  } catch (error) {
    console.error("[Payments] History fetch error:", error);
    return res.status(500).json({ error: "Failed to fetch payment history" });
  }
});

router.post("/verify-payment", requireAuth, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ error: "Payment system not configured" });
    }

    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== req.user!.userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment not completed", status: session.payment_status });
    }

    const requestId = session.metadata?.requestId;
    if (!requestId) {
      return res.status(400).json({ error: "Session is missing requestId" });
    }

    const result = await prisma.$transaction((tx) =>
      completeRequestPayment(tx, {
        requestId,
        paymentId: session.metadata?.paymentId,
        sessionId: session.id,
        amountTotal: session.amount_total,
        currency: session.currency,
        customerEmail: session.customer_email,
      }),
    );

    return res.json({
      message: "Payment verified successfully",
      request: result.request,
      dream: { id: result.request.dreamId },
      payment: { id: result.paymentId },
    });
  } catch (error) {
    console.error("[Payments] Verify payment error:", error);
    return res.status(500).json({ error: "Failed to verify payment" });
  }
});

export default router;
