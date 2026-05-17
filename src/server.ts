import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

import authRouter from "./routes/auth";
import profileRouter from "./routes/profile";
import dreamsRouter from "./routes/dreams";
import messagesRouter from "./routes/messages";
import commentsRouter from "./routes/comments";
import requestsRouter from "./routes/requests";
import chatRouter from "./routes/chat";
import notificationsRouter from "./routes/notifications";
import plansRouter from "./routes/plans";
import paymentsRoutes from "./routes/payments";
import adminRouter from "./routes/admin";
import adminPagesRouter from "./routes/admin-pages";
import pagesRouter from "./routes/pages";
import reviewsRouter from "./routes/reviews";

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
app.use("/api/reviews", reviewsRouter);

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

app.listen(port, () => {
  console.log(`\n🚀 Mubasharat Backend Server`);
  console.log(`📍 Running on: http://localhost:${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`✅ CORS enabled for: ${allowedOrigins.join(", ")}`);
  console.log(`📁 Uploads directory: ${uploadsDir}\n`);
});
