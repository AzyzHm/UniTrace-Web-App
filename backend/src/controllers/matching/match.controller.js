import { toMatchDTO } from '../../presenters/match.presenter.js';
import { assertObjectId, parseRespondBody, parseListQuery } from '../../validators/matching.validator.js';

// binôme 1's auth middleware may expose req.user.id or req.user._id; role 'admin' is assumed (check users.role values)
// Adapter for the auth middleware: req.user.id or req.user._id, role 'admin' (confirm against require-auth.js)
const viewerOf = (req) => ({ id: String(req.user.id ?? req.user._id ?? req.user.sub), isAdmin: req.user.role === 'admin' });

/**
 * Thin HTTP layer: validate -> call the service -> present.
 * Errors are thrown as MatchingError (statusCode + code) and handled by the
 * project's error middleware (see routes file for a fallback).
 */
class MatchController {
  constructor({ matchingService }) {
    this.service = matchingService;
  }

  listMine = async (req, res, next) => {
    try {
      const { page, limit, status } = parseListQuery(req.query);
      const viewer = viewerOf(req);
      const { items, total } = await this.service.listMine(viewer.id, { page, limit, status });
      res.json({
        data: items.map((m) => toMatchDTO(m, viewer)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (e) {
      next(e);
    }
  };

  getOne = async (req, res, next) => {
    try {
      const viewer = viewerOf(req);
      const { match, lost, found } = await this.service.getMatchView(assertObjectId(req.params.id), viewer);
      res.json({ data: toMatchDTO(match, viewer, { lost, found }) });
    } catch (e) {
      next(e);
    }
  };

  respond = async (req, res, next) => {
    try {
      const viewer = viewerOf(req);
      const body = parseRespondBody(req.body);
      const match = await this.service.respond(assertObjectId(req.params.id), viewer.id, body);
      res.json({ data: toMatchDTO(match, viewer) });
    } catch (e) {
      next(e);
    }
  };

  markRecovered = async (req, res, next) => {
    try {
      const viewer = viewerOf(req);
      const match = await this.service.markRecovered(assertObjectId(req.params.id), viewer.id);
      res.json({ data: toMatchDTO(match, viewer) });
    } catch (e) {
      next(e);
    }
  };

  /** Case 2: all matches proposed for one declaration, best first. */
  listForDeclaration = async (req, res, next) => {
    try {
      const viewer = viewerOf(req);
      const items = await this.service.listForDeclaration(assertObjectId(req.params.declarationId, 'declarationId'), viewer);
      res.json({ data: items.map((m) => toMatchDTO(m, viewer)) });
    } catch (e) {
      next(e);
    }
  };

  /** Admin: every match, optionally only the disputed ones. */
  listAll = async (req, res, next) => {
    try {
      const { page, limit, status, disputed } = parseListQuery(req.query, { allowDisputed: true });
      const viewer = viewerOf(req);
      const { items, total } = await this.service.listAll({ page, limit, status, disputed });
      res.json({
        data: items.map((m) => toMatchDTO(m, viewer)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (e) {
      next(e);
    }
  };
}

export const createMatchController = (deps) => new MatchController(deps);