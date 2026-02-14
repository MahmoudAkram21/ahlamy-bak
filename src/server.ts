import http from "http";
import express from "express";
import { Server as SocketServer } from "socket.io";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { verifyToken } from "./utils/auth.js";

import authRouter from "./routes/auth.js";
import profileRouter from "./routes/profile.js";
import dreamsRouter from "./routes/dreams.js";
import messagesRouter from "./routes/messages.js";
import commentsRouter from "./routes/comments.js";
import requestsRouter from "./routes/requests.js";
import chatRouter from "./routes/chat.js";
import notificationsRouter from "./routes/notifications.js";
import plansRouter from "./routes/plans.js";
import paymentsRoutes from "./routes/payments.js";
import adminRouter from "./routes/admin.js";
import adminPagesRouter from "./routes/admin-pages.js";
import pagesRouter from "./routes/pages.js";
import appAettings from "./routes/appSettings.js"
dotenv.config({ path: process.env.BACKEND_ENV_PATH || ".env" });

const app = express();

// Create uploads directories if they don't exist
const uploadsDir = path.join(__dirname, "../public/uploads/avatars");
const audioDir = path.join(__dirname, "../public/uploads/audio");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("✅ Created avatars directory:", uploadsDir);
}

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
  console.log("✅ Created audio directory:", audioDir);
}

const allowedOrigins = (
  process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// CORS configuration
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Logging middleware
app.use(morgan("dev"));

// Static file serving for uploads
app.use("/uploads", express.static(path.join(__dirname, "../public/uploads")));

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mubasharat-backend",
    timestamp: new Date().toISOString(),
    port: Number(process.env.PORT) || 5000,
  });
});

// API routes
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/dreams", dreamsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/comments", commentsRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admin", adminRouter);
app.use("/api/admin/pages", adminPagesRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/app-settings", appAettings);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[Backend Error]:", err);

    const statusCode = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal server error";

    res.status(statusCode).json({
      error: message,
      ...(process.env.NODE_ENV === "development" && { stack: err?.stack }),
    });
  }
);

const port = Number(process.env.PORT) || 5000;

const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  path: "/socket.io",
});

const SESSION_COOKIE_NAME = "auth_token";

io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.cookie
      ?.split(";")
      .find((c: string) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split("=")[1]
      ?.trim();
  if (!token) {
    return next(new Error("Authentication required"));
  }
  const payload = verifyToken(token);
  if (!payload) {
    return next(new Error("Invalid or expired token"));
  }
  (socket as any).userId = payload.userId;
  next();
});

io.on("connection", (socket) => {
  const userId = (socket as any).userId;
  socket.on("join_dream", async (data: { dreamId: string }) => {
    const { dreamId } = data || {};
    if (!dreamId) return;
    const prisma = (await import("./lib/prisma")).default;
    const dream = await prisma.dream.findUnique({
      where: { id: dreamId },
      select: { dreamerId: true, interpreterId: true },
    });
    if (!dream) return;
    const isParticipant =
      dream.dreamerId === userId || dream.interpreterId === userId;
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isAdmin =
      profile?.role === "admin" || profile?.role === "super_admin";
    if (!isParticipant && !isAdmin) return;
    socket.join(`dream:${dreamId}`);
  });
  socket.on("leave_dream", (data: { dreamId: string }) => {
    if (data?.dreamId) socket.leave(`dream:${data.dreamId}`);
  });
});

app.set("io", io);

server.listen(port, () => {
  console.log(`\n🚀 Mubasharat Backend Server`);
  console.log(`📍 Running on: http://localhost:${port}`);
  console.log(`🔌 WebSocket (Socket.io) enabled`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`✅ CORS enabled for: ${allowedOrigins.join(", ")}`);
  console.log(`📁 Uploads directory: ${uploadsDir}\n`);
});
