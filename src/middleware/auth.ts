import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth.js';

const SESSION_COOKIE_NAME = 'auth_token';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  console.log(req.headers)
  console.log(req.headers.authorization)

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

  req.user = payload;

  return next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
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
      req.user = payload;
    }
  }

  next();
}



