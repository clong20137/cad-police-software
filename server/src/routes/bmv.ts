import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { AccessControlService } from '../services/AccessControlService';
import { AuthService } from '../services/AuthService';
import { BmvService } from '../services/BmvService';
import { BmvInquiryRequest } from '../types/auth';

const router = Router();

router.post(
  '/inquiries',
  authMiddleware,
  requirePermission('query_bmv'),
  async (req: Request<{}, {}, BmvInquiryRequest>, res: Response): Promise<void> => {
    try {
      const requester = await AuthService.getUser(req.user?.id || '');
      if (!requester) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      const inquiry = await AccessControlService.authorizeSensitiveInquiry(req.body, requester, 'BMV') as BmvInquiryRequest;
      res.json(await BmvService.submitInquiry(inquiry, requester.id));
    } catch (error) {
      await AccessControlService.auditDeniedLookup(req.user?.id, 'BMV', (error as Error).message || 'Unable to submit BMV inquiry');
      res.status(400).json({ error: (error as Error).message || 'Unable to submit BMV inquiry' });
    }
  }
);

export default router;
