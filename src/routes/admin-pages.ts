import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

function isAdminRole(role?: string) {
    return role === 'admin' || role === 'super_admin';
}

// Get all pages (admin only)
router.get('/', requireAuth, async (req, res) => {
    try {
        if (!isAdminRole(req.user!.role)) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const pages = await prisma.pageContent.findMany({
            select: {
                id: true,
                pageKey: true,
                title: true,
                isPublished: true,
                updatedAt: true,
            },
            orderBy: { pageKey: 'asc' },
        });

        return res.json({ pages });
    } catch (error) {
        console.error('[Admin Pages] List error:', error);
        return res.status(500).json({ error: 'Failed to fetch pages' });
    }
});

// Get specific page (admin only)
router.get('/:pageKey', requireAuth, async (req, res) => {
    try {
        if (!isAdminRole(req.user!.role)) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const { pageKey } = req.params;

        const page = await prisma.pageContent.findUnique({
            where: { pageKey },
        });

        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }

        return res.json({ page });
    } catch (error) {
        console.error('[Admin Pages] Fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch page' });
    }
});

// Update page content (admin only)
router.patch('/:pageKey', requireAuth, async (req, res) => {
    try {
        if (!isAdminRole(req.user!.role)) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const { pageKey } = req.params;
        const { title, content, metadata, isPublished } = req.body;

        const updateData: any = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (metadata !== undefined) updateData.metadata = metadata;
        if (isPublished !== undefined) updateData.isPublished = isPublished;

        const page = await prisma.pageContent.update({
            where: { pageKey },
            data: updateData,
        });

        console.log(`[Admin Pages] Updated page: ${pageKey}`);
        return res.json({ page });
    } catch (error) {
        console.error('[Admin Pages] Update error:', error);
        return res.status(500).json({ error: 'Failed to update page' });
    }
});

router.delete('/:pageKey', requireAuth, async (req, res) => {
    try {
        if (!isAdminRole(req.user!.role)) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const { pageKey } = req.params;

        const page = await prisma.pageContent.findUnique({
            where: { pageKey },
        });

        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }

        await prisma.pageContent.delete({
            where: { pageKey },
        });

        return res.json({ success: true });
    } catch (error) {
        console.error('[Admin Pages] Delete error:', error);
        return res.status(500).json({ error: 'Failed to delete page' });
    }
});

// Create or seed default pages (admin only)
router.post('/seed', requireAuth, async (req, res) => {
    try {
        if (!isAdminRole(req.user!.role)) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }

        const defaultPages = [
            {
                pageKey: 'about',
                title: 'عن مبشرات',
                content: '<h1>عن مبشرات</h1><p>منصة متخصصة في تفسير الرؤى والأحلام وفق المنهج الإسلامي الصحيح.</p>',
                metadata: { seoDescription: 'تعرف على منصة مبشرات لتفسير الرؤى' },
            },
            {
                pageKey: 'terms',
                title: 'الشروط والأحكام',
                content: `
                    <h1>الشروط والأحكام</h1>
                    <p>يرجى قراءة هذه الشروط بعناية قبل استخدام تطبيق أحلامي. باستخدامك للتطبيق فإنك توافق على الالتزام بهذه الشروط.</p>
                    <h2>استخدام الخدمة</h2>
                    <p>يوفر التطبيق خدمة استقبال الرؤى وطلبات التفسير ومتابعتها عبر المنصة. يجب استخدام الخدمة بطريقة نظامية ومحترمة وعدم إرسال أي محتوى مخالف أو مسيء.</p>
                    <h2>الحسابات</h2>
                    <p>يتحمل المستخدم مسؤولية الحفاظ على سرية بيانات الدخول الخاصة به، كما يجب تقديم بيانات صحيحة عند إنشاء الحساب أو تحديثه.</p>
                    <h2>طلبات التفسير</h2>
                    <p>تفسيرات الرؤى المقدمة عبر التطبيق اجتهادية ولا تعد وعداً بحدوث أمر معين أو بديلاً عن الاستشارة الشرعية أو الطبية أو القانونية المتخصصة.</p>
                    <h2>الدفع والاشتراكات</h2>
                    <p>قد تتطلب بعض الخدمات دفع رسوم أو الاشتراك في باقات محددة. يتم توضيح تفاصيل كل باقة قبل إتمام عملية الدفع.</p>
                    <h2>التواصل والدعم</h2>
                    <p>لأي استفسار أو طلب مساعدة، يمكن التواصل مع فريق الدعم من خلال صفحة الدعم والمساعدة داخل التطبيق.</p>
                    <h2>تحديث الشروط</h2>
                    <p>يحق لإدارة التطبيق تحديث هذه الشروط عند الحاجة، ويعد استمرار استخدام التطبيق بعد التحديث موافقة على الشروط المعدلة.</p>
                `,
                metadata: { seoDescription: 'شروط وأحكام استخدام تطبيق أحلامي' },
            },
            {
                pageKey: 'guide',
                title: 'دليل الاستخدام',
                content: '<h1>دليل الاستخدام</h1><p>كيفية استخدام منصة مبشرات خطوة بخطوة.</p>',
                metadata: { seoDescription: 'دليل استخدام منصة مبشرات' },
            },
            {
                pageKey: 'faqs',
                title: 'الأسئلة الشائعة',
                content: `
                    <h1>الأسئلة الشائعة</h1>
                    <h2>كيف أرسل رؤيا جديدة؟</h2>
                    <p>يمكنك إرسال الرؤيا من داخل التطبيق بعد تسجيل الدخول واختيار الخطة المناسبة ثم كتابة تفاصيل الرؤيا بوضوح.</p>
                    <h2>متى يصلني التفسير؟</h2>
                    <p>تظهر حالة الطلب داخل التطبيق، ويتم إشعارك عند إسناد الرؤيا إلى مفسر وعند اكتمال التفسير.</p>
                    <h2>هل يمكنني متابعة الطلب مع المفسر؟</h2>
                    <p>نعم، يمكن متابعة المحادثة الخاصة بالرؤيا داخل صفحة الطلب عند الحاجة إلى استفسار أو توضيح.</p>
                `,
                metadata: { seoDescription: 'الأسئلة الشائعة حول استخدام تطبيق أحلامي' },
            },
            {
                pageKey: 'support',
                title: 'الدعم والمساعدة',
                content: '<h1>الدعم والمساعدة</h1><p>للتواصل معنا وطلب المساعدة.</p>',
                metadata: { seoDescription: 'دعم ومساعدة منصة مبشرات' },
            },
            {
                pageKey: 'good-news',
                title: 'البشارات',
                content: '<h1>البشارات</h1><p>قال رسول الله صلى الله عليه وسلم: "لم يبق من النبوة إلا المبشرات"</p>',
                metadata: { seoDescription: 'البشارات في الإسلام' },
            },
        ];

        const created = [];
        for (const pageData of defaultPages) {
            const existing = await prisma.pageContent.findUnique({
                where: { pageKey: pageData.pageKey },
            });

            if (!existing) {
                const page = await prisma.pageContent.create({
                    data: pageData,
                });
                created.push(page.pageKey);
            }
        }

        return res.json({
            message: 'Default pages seeded',
            created,
            total: defaultPages.length,
        });
    } catch (error) {
        console.error('[Admin Pages] Seed error:', error);
        return res.status(500).json({ error: 'Failed to seed pages' });
    }
});

export default router;
