import { DECISION } from '../../constants/matching/correspondence.js';
import { toCorrespondenceResponse } from '../../presenters/matching/correspondence.presenter.js';

export function createCorrespondenceController({ correspondenceService }) {
  if (!correspondenceService) throw new Error('createCorrespondenceController(): correspondenceService is required');

  const react = (decision) => async (req, res) => {
    const c = await correspondenceService.react(req.user, req.params.id, decision, req.body.comment || undefined);
    res.status(200).json({ id: String(c._id), status: c.status });
  };

  return {
    async listForDeclaration(req, res) {
      const views = await correspondenceService.listForDeclaration(req.user, req.params.declarationId);
      res.status(200).json({ items: views.map(toCorrespondenceResponse) });
    },

    async listMine(req, res) {
      // Defaults repeated here so it works whether validate writes back to req.query or not.
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const { items, total } = await correspondenceService.listMine(req.user, {
        status: req.query.status,
        page,
        limit,
      });
      res.status(200).json({
        items: items.map(toCorrespondenceResponse),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      });
    },

    async getOne(req, res) {
      const result = await correspondenceService.getOne(req.user, req.params.id);
      res.status(200).json({ correspondence: toCorrespondenceResponse(result) });
    },

    accept: react(DECISION.ACCEPT),
    refuse: react(DECISION.REFUSE),
    verify: react(DECISION.VERIFY),

    async recover(req, res) {
      const c = await correspondenceService.markRecovered(req.user, req.params.id);
      res.status(200).json({ id: String(c._id), status: c.status });
    },

    async rematch(req, res) {
      const created = await correspondenceService.rematch(req.user, req.params.declarationId);
      res.status(200).json({ created });
    },
  };
}