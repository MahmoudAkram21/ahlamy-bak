import { Router } from 'express';
import prisma from '../lib/prisma';

const router  =Router();
router.get("/", async (req, res) => {
try{
    const settings = await prisma.appSetting.findMany({
        select:{
            key : true,
            value: true
        }
    })
    
    res.json({ settings })
}catch(error){
    console.error('[AppSettings] Fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch app settings' });

} });

export default router;