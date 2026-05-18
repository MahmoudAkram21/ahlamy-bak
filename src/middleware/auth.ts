import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { verifyToken } from '../utils/auth';

const SESSION_COOKIE_NAME = 'auth_token';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];

  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
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
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      ...payload,
      email: user.email,
      role: user.profile.role,
    };
  } catch (error) {
    console.error('[Auth] Token user lookup error:', error);
    return res.status(500).json({ error: 'Authentication check failed' });
  }

  return next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];

  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: {
            email: true,
            deletedAt: true,
            profile: {
              select: {
                role: true,
                deletedAt: true,
              },
            },
          },
        });

        if (user && !user.deletedAt && user.profile && !user.profile.deletedAt) {
          req.user = {
            ...payload,
            email: user.email,
            role: user.profile.role,
          };
        }
      } catch (error) {
        console.error('[Auth] Optional token user lookup error:', error);
      }
    }
  }

  next();
}



