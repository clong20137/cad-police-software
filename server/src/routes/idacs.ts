import { Router, Request, Response } from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';
import { AccessControlService } from '../services/AccessControlService';
import { AuthService } from '../services/AuthService';
import { IdacsService } from '../services/IdacsService';
import { IdacsInquiryRequest } from '../types/auth';

const router = Router();

router.post(
  '/inquiries',
  authMiddleware,
  requirePermission('query_idacs'),
  async (req: Request<{}, {}, IdacsInquiryRequest>, res: Response): Promise<void> => {
    try {
      const requester = await AuthService.getUser(req.user?.id || '');
      if (!requester) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      const inquiry = await AccessControlService.authorizeSensitiveInquiry(req.body, requester, 'IDACS') as IdacsInquiryRequest;
      res.json(await IdacsService.submitInquiry(inquiry, requester.id));
    } catch (error) {
      await AccessControlService.auditDeniedLookup(req.user?.id, 'IDACS', (error as Error).message || 'Unable to submit IDACS inquiry');
      res.status(400).json({ error: (error as Error).message || 'Unable to submit IDACS inquiry' });
    }
  }
);

export default router;
