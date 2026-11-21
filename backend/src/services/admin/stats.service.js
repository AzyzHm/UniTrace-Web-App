import { DECLARATION_STATUS_VALUES } from '../../constants/declarations/declaration-status.js';
import { DECLARATION_TYPE_VALUES } from '../../constants/declarations/declaration-types.js';
import { REPORT_STATUS_VALUES } from '../../constants/admin/report-status.js';
import { ValidationError } from '../../exceptions/app-error.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;

const invalid = (field, message) => new ValidationError('Invalid input', [{ field, message }]);

// Every known value starts at 0, so the dashboard always shows the same keys.
const zeroed = (values) => Object.fromEntries(values.map((value) => [value, 0]));

function summarizeDeclarations(rows) {
  const byType = zeroed(DECLARATION_TYPE_VALUES);
  const byStatus = zeroed(DECLARATION_STATUS_VALUES);
  let total = 0;

  for (const { _id, count } of rows) {
    total += count;
    byType[_id.type] = (byType[_id.type] ?? 0) + count;
    byStatus[_id.status] = (byStatus[_id.status] ?? 0) + count;
  }

  return {
    total,
    byType,
    byStatus,
    // Placeholders until the matching domain sets these statuses.
    matches: byStatus.matched,
    recovered: byStatus.resolved,
  };
}

function summarizeReports(rows) {
  const byStatus = zeroed(REPORT_STATUS_VALUES);
  let total = 0;

  for (const { _id, count } of rows) {
    total += count;
    byStatus[_id] = (byStatus[_id] ?? 0) + count;
  }

  return { total, byStatus };
}

export function createStatsService({ statsRepository, clock = () => new Date() }) {
  if (!statsRepository) {
    throw new Error('createStatsService(): statsRepository is required');
  }

  function resolveRange({ from, to }) {
    const end = to ?? clock();
    const start = from ?? new Date(end.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

    if (start > end) throw invalid('from', 'from must be before to');
    if (end - start > MAX_RANGE_DAYS * DAY_MS) {
      throw invalid('to', `the range cannot exceed ${MAX_RANGE_DAYS} days`);
    }
    return { start, end };
  }

  return {
    async dashboard(query = {}) {
      const { start, end } = resolveRange(query);

      // Totals are current state (all time). Only the timeline follows the requested range.
      const [activeUsers, declarationRows, reportRows, dayRows] = await Promise.all([
        statsRepository.countActiveUsers(),
        statsRepository.declarationsByTypeAndStatus(),
        statsRepository.reportsByStatus(),
        statsRepository.declarationsPerDay({ from: start, to: end }),
      ]);

      return {
        range: { from: start, to: end },
        users: { active: activeUsers },
        declarations: summarizeDeclarations(declarationRows),
        reports: summarizeReports(reportRows),
        timeline: dayRows.map((row) => ({ date: row._id, created: row.count })),
      };
    },
  };
}
