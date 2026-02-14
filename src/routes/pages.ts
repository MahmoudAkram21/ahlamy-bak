import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();


// Public endpoint - Get page content by key
router.get('/:pageKey', async (req, res) => {
    try {
        const { pageKey } = req.params;

        const page = await prisma.pageContent.findFirst({
            where: {
                pageKey,
                isPublished: true,
            },
        });

        if (!page) {
            return res.status(404).json({ error: 'Page not found' });
        }

        return res.json({ page });
    } catch (error) {
        console.error('[Pages] Fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch page' });
    }
});


router.post("/update", async (req, res) => {
  try {
    const { pageKey, title, content, metadata, isPublished } = req.body;

    const page = await prisma.pageContent.update({
      where: { pageKey },
      data: {
        title,
        content,
        metadata,
        isPublished,
      }
    });

    return res.json({ page });
  } catch (error) {
    console.error('[Pages] Create/update error:', error);
    return res.status(500).json({ error: 'Failed to create/update page' });
  }
});

export default router;
