interface InterpreterApprovalEmailParams {
  to: string;
  fullName: string | null;
  temporaryPassword: string;
}

interface EmailDeliveryResult {
  sent: boolean;
  provider: 'resend' | 'console';
  error?: string;
}

const fromEmail = process.env.MAIL_FROM || 'Ahlamy <no-reply@ahlami.app>';
const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';

export async function sendInterpreterApprovalEmail({
  to,
  fullName,
  temporaryPassword,
}: InterpreterApprovalEmailParams): Promise<EmailDeliveryResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const subject = 'تم قبول طلب التسجيل كمفسر في أحلامي';
  const loginUrl = `${appUrl.replace(/\/$/, '')}/auth/login`;
  const displayName = fullName || to;
  const text = [
    `مرحباً ${displayName},`,
    '',
    'تم قبول طلب التسجيل كمفسر في أحلامي.',
    `البريد الإلكتروني: ${to}`,
    `كلمة المرور المؤقتة: ${temporaryPassword}`,
    '',
    `يمكنك تسجيل الدخول من هنا: ${loginUrl}`,
    'يرجى تغيير كلمة المرور بعد تسجيل الدخول.',
  ].join('\n');

  if (!resendApiKey) {
    console.warn('[Email] RESEND_API_KEY is not configured. Interpreter approval email was not sent.');
    console.warn(`[Email] Temporary password for ${to}: ${temporaryPassword}`);
    return { sent: false, provider: 'console', error: 'RESEND_API_KEY is not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { sent: false, provider: 'resend', error: errorText || `HTTP ${response.status}` };
    }

    return { sent: true, provider: 'resend' };
  } catch (error) {
    return {
      sent: false,
      provider: 'resend',
      error: error instanceof Error ? error.message : 'Unknown email delivery error',
    };
  }
}
