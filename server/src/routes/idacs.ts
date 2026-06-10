import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { IdacsService } from '../services/IdacsService';
import { IdacsInquiryRequest } from '../types/auth';

const router = Router();

router.post(
  '/inquiries',
  authMiddleware,
  requirePermission('query_idacs'),
  async (req: Request<{}, {}, IdacsInquiryRequest>, res: Response): Promise<void> => {
    try {
      res.json(await IdacsService.submitInquiry(req.body, req.user?.id || ''));
    } catch (error) {
      res.status(400).json({ error: (error as Error).message || 'Unable to submit IDACS inquiry' });
    }
  }
);

export default router;
