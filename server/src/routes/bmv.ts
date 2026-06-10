import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { BmvService } from '../services/BmvService';
import { BmvInquiryRequest } from '../types/auth';

const router = Router();

router.post(
  '/inquiries',
  authMiddleware,
  requirePermission('view_dispatch'),
  async (req: Request<{}, {}, BmvInquiryRequest>, res: Response): Promise<void> => {
    try {
      res.json(await BmvService.submitInquiry(req.body, req.user?.id || ''));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to submit BMV inquiry' });
    }
  }
);

export default router;
