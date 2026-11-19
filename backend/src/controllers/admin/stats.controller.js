export function createStatsController({ statsService }) {
  if (!statsService) {
    throw new Error('createStatsController(): statsService is required');
  }

  return {
    async dashboard(req, res) {
      const dashboard = await statsService.dashboard(req.query);

      res.status(200).json(dashboard);
    },
  };
}
