import Stripe from 'stripe';

let stripe: Stripe | null = null;

if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_YOUR_SECRET_KEY_HERE') {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2026-02-25.clover',
        typescript: true,
    });
    console.log('✅ Stripe initialized');
} else {
    console.warn('⚠️ Stripe not configured - Payment features disabled. Add STRIPE_SECRET_KEY to .env');
}

export default stripe;
