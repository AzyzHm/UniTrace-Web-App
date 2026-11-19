import { toReportResponse } from '../../presenters/admin/report-admin.presenter.js';

export function createReportController({ reportService }) {
  if (!reportService) {
    throw new Error('createReportController(): reportService is required');
  }

  return {
    async create(req, res) {
      const report = await reportService.create(req.user, req.body.declarationId, {
        reason: req.body.reason,
        comment: req.body.comment,
      });

      res.status(201).json({ report: toReportResponse(report) });
    },

    async list(req, res) {
      const { items, total } = await reportService.listOpen(req.query);
      const { page, limit } = req.query;

      res.status(200).json({
        reports: items.map(toReportResponse),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },

    async treat(req, res) {
      const report = await reportService.treat(req.user, req.params.id, req.body);

      res.status(200).json({ report: toReportResponse(report) });
    },
  };
}
