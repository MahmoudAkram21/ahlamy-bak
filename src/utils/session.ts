import { CookieOptions, Response } from 'express';

const SESSION_COOKIE_NAME = 'auth_token';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds
const VALID_SAME_SITE_VALUES = new Set(['lax', 'strict', 'none']);

function getBooleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function getSameSite(): CookieOptions['sameSite'] {
  const configuredValue = process.env.SESSION_COOKIE_SAME_SITE?.toLowerCase();

  if (configuredValue && VALID_SAME_SITE_VALUES.has(configuredValue)) {
    return configuredValue as CookieOptions['sameSite'];
  }

  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
}

function getCookieOptions(): Pick<CookieOptions, 'httpOnly' | 'secure' | 'sameSite' | 'path'> {
  const sameSite = getSameSite();
  const secure = getBooleanEnv(
    process.env.SESSION_COOKIE_SECURE,
    process.env.NODE_ENV === 'production' || sameSite === 'none'
  );

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...getCookieOptions(),
    maxAge: COOKIE_MAX_AGE * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.cookie(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(),
    expires: new Date(0),
  });
}



