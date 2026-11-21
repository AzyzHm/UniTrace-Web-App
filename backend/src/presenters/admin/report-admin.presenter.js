// Admin view of a report. The reporter is shown to admins only.
export function toReportResponse(report) {
  return {
    id: report.id ?? String(report._id),
    declaration: String(report.declaration),
    reporter: String(report.reporter),
    reason: report.reason,
    comment: report.comment ?? null,
    status: report.status,
    resolution: report.resolution ?? null,
    treatedAt: report.treatedAt ?? null,
    createdAt: report.createdAt,
  };
}
