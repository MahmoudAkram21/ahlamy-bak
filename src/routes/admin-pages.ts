import { Router } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Get all pages (super admin only)
router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user!.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden - Super admin access required' });
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

// Get specific page (super admin only)
router.get('/:pageKey', requireAuth, async (req, res) => {
    try {
        if (req.user!.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden - Super admin access required' });
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

// Update page content (super admin only)
router.patch('/:pageKey', requireAuth, async (req, res) => {
    try {
        if (req.user!.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden - Super admin access required' });
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

// Create or seed default pages (super admin only)
router.post('/seed', requireAuth, async (req, res) => {
    try {
        if (req.user!.role !== 'super_admin') {
            return res.status(403).json({ error: 'Forbidden - Super admin access required' });
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
                content: '<h1>الشروط والأحكام</h1><p>يرجى قراءة هذه الشروط بعناية قبل استخدام المنصة.</p>',
                metadata: { seoDescription: 'شروط وأحكام استخدام منصة مبشرات' },
            },
            {
                pageKey: 'guide',
                title: 'دليل الاستخدام',
                content: '<h1>دليل الاستخدام</h1><p>كيفية استخدام منصة مبشرات خطوة بخطوة.</p>',
                metadata: { seoDescription: 'دليل استخدام منصة مبشرات' },
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
            {
                pageKey: 'rate',
                title: 'قيّم التطبيق',
                content: '<h1>قيّم التطبيق</h1><p>ملاحظاتك تساعدنا على تطوير التجربة وتحسين خدمات التفسير للجميع.</p><h2>لماذا نطلب تقييمك؟</h2><p>التقييمات الإيجابية ترفع ثقة المستخدمين الجدد وتشجعنا على الاستثمار أكثر في تطوير خصائص المنصة.</p><h2>كيف تقيّمنا؟</h2><ol><li>اختر متجر التطبيقات الذي تستخدمه.</li><li>اكتب بضع كلمات عن تجربتك.</li><li>أرسل التقييم وشارك لقطة شاشة مع أصدقائك.</li></ol>',
                metadata: { seoDescription: 'قيّم تطبيق أحلامي' },
            },
            {
                pageKey: 'join',
                title: 'انضم لفريق المعبّرين',
                content: '<h1>انضم لفريق المعبّرين</h1><p>نبحث دائماً عن معبرين معتمدين يمتلكون علماً شرعياً وخبرة عملية في تفسير الرؤى.</p><h2>متطلبات الانضمام</h2><ul><li>شهادة أو تزكية معتمدة في علوم تفسير الرؤى.</li><li>التزام بأخلاقيات المهنة واحترام خصوصية المستخدمين.</li><li>قدرة على الرد المتوازن والسريع عبر المنصة.</li></ul><h2>ماذا نقدّم لك؟</h2><p>لوحة تحكم متقدمة، وإحصائيات لأداءك، مع فريق دعم فني يساندك، ونظام تقييم يعزز حضورك.</p><h2>خطوات التقديم</h2><ol><li>أرسل نبذة عنك وسيرتك عبر نموذج التواصل.</li><li>سنراجع الطلب ونتواصل معك لإجراء مقابلة قصيرة.</li><li>بعد الموافقة، ستتلقى حساباً مخصصاً للوصول إلى لوحة المعبّر.</li></ol>',
                metadata: { seoDescription: 'انضم لفريق المعبّرين في أحلامي' },
            },
            {
                pageKey: 'screens',
                title: 'شاشات الافتتاح',
                content: '<h1>شاشات الافتتاح</h1><p>شاشة الترحيب التي تظهر عند فتح التطبيق.</p>',
                metadata: { seoDescription: 'شاشات الافتتاح' },
            },
            {
                pageKey: 'plans',
                title: 'باقات أحلامي',
                content: '<h1>باقات أحلامي</h1><p>اختر الباقة المناسبة لك للحصول على تفسير رؤاك من معبّرين معتمدين.</p>',
                metadata: { seoDescription: 'باقات وتذاكر التفسير' },
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
