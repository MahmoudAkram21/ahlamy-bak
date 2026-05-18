import type { Server as HttpServer } from "http";
import prisma from "./prisma";
import { chatEvents } from "./chatEvents";
import { verifyToken } from "../utils/auth";

type SocketServer = {
  on: (event: string, handler: (...args: any[]) => void) => void;
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
};

type Socket = {
  data: { userId?: string; role?: string };
  join: (room: string) => void;
  leave: (room: string) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
};

const SESSION_COOKIE_NAME = "auth_token";

function parseCookieToken(cookieHeader?: string) {
  if (!cookieHeader) return null;
  const tokenPair = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`));
  return tokenPair ? decodeURIComponent(tokenPair.slice(SESSION_COOKIE_NAME.length + 1)) : null;
}

async function canAccessRequest(requestId: string, userId: string, role?: string) {
  if (role === "admin" || role === "super_admin") return true;

  const request = await prisma.request.findFirst({
    where: {
      id: requestId,
      dream: { deletedAt: null },
      OR: [{ dreamerId: userId }, { interpreterId: userId }],
    },
    select: { id: true },
  });

  return Boolean(request);
}

export function attachSocketServer(httpServer: HttpServer, allowedOrigins: string[], allowedOriginPatterns: RegExp[]) {
  let ServerCtor: any;
  try {
    ({ Server: ServerCtor } = require("socket.io"));
  } catch {
    console.warn("[Socket] socket.io is not installed. Run: npm install socket.io");
    return null;
  }

  const io: SocketServer = new ServerCtor(httpServer, {
    cors: {
      origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalizedOrigin = origin.replace(/\/$/, "");
        callback(
          null,
          allowedOrigins.includes(normalizedOrigin) ||
            allowedOriginPatterns.some((pattern) => pattern.test(normalizedOrigin)),
        );
      },
      credentials: true,
    },
  });

  io.on("connection", async (socket: Socket & { handshake: any; disconnect: (close?: boolean) => void }) => {
    const token = socket.handshake.auth?.token || parseCookieToken(socket.handshake.headers?.cookie);
    const payload = typeof token === "string" ? verifyToken(token) : null;

    if (!payload) {
      socket.disconnect(true);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        deletedAt: true,
        profile: {
          select: {
            role: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!user || user.deletedAt || !user.profile || user.profile.deletedAt) {
      socket.disconnect(true);
      return;
    }

    socket.data.userId = payload.userId;
    socket.data.role = user.profile.role;

    socket.on("request:join", async ({ requestId }: { requestId?: string }) => {
      if (!requestId || !socket.data.userId) return;
      if (await canAccessRequest(requestId, socket.data.userId, socket.data.role)) {
        socket.join(`request:${requestId}`);
      }
    });

    socket.on("request:leave", ({ requestId }: { requestId?: string }) => {
      if (requestId) socket.leave(`request:${requestId}`);
    });
  });

  chatEvents.on("request-message", ({ requestId, message }) => {
    io.to(`request:${requestId}`).emit("request:message", message);
  });

  return io;
}
