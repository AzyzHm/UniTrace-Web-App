import { isAdminRole } from '../../constants/common/roles.js';
import {
  CORRESPONDENCE_STATUS as S,
  DECISION as D,
  MATCH_EVENT_TYPE as E,
} from '../../constants/matching/correspondence.js';
import {
  DECLARATION_TYPE,
  MATCH_FIELDS,
  OUT_OF_MATCHING_STATUSES,
  RESOLVED_STATUS,
} from '../../constants/matching/declaration-adapter.js';
import { NOTIFICATION_TYPE as N } from '../../constants/notifications/notification.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../exceptions/app-error.js';

const RELEVANT_FIELDS = [...MATCH_FIELDS, 'status'];

function computeStatus({ lost, found }) {
  const a = lost.decision;
  const b = found.decision;
  if (a === D.REFUSE || b === D.REFUSE) return S.REFUSED;
  if (a === D.ACCEPT && b === D.ACCEPT) return S.ACCEPTED;
  if (a === D.VERIFY || b === D.VERIFY) return S.TO_VERIFY;
  return S.PROPOSED;
}

export function createCorrespondenceService({
  matchingRepository: repo,
  matchingService,
  notificationService,
  declarationService,
  userRepository,
}) {
  const required = {
    repo,
    matchingService,
    notificationService,
    declarationService,
    userRepository,
  };
  for (const [name, dep] of Object.entries(required)) {
    if (!dep) throw new Error(`createCorrespondenceService(): ${name} is required`);
  }

  const notFound = () => new NotFoundError('Correspondence not found');

  const sideOf = (c, user) =>
    String(c.lost.owner) === String(user._id)
      ? 'lost'
      : String(c.found.owner) === String(user._id)
        ? 'found'
        : null;

  // The other party's identity is revealed only once both sides accepted.
  async function contactFor(c, side) {
    if (!side || ![S.ACCEPTED, S.RESOLVED].includes(c.status)) return null;
    const other = await userRepository.findById(c[side === 'lost' ? 'found' : 'lost'].owner);
    if (!other || other.deletedAt) return null; // anonymized account
    return { username: other.username, email: other.email, phone: other.phone ?? null };
  }

  const view = async (user, c) => {
    const side = sideOf(c, user);
    return { correspondence: c, side, contact: await contactFor(c, side) };
  };

  // A user outside the match must not even know it exists (same rule as hidden declarations).
  async function loadAsParticipant(user, id) {
    const c = await repo.findByIdPopulated(id);
    if (!c) throw notFound();
    const side = sideOf(c, user);
    if (!side) throw notFound();
    return { c, side, other: side === 'lost' ? 'found' : 'lost' };
  }

  async function closeForDeclarations(declIds, reason, exceptId = null) {
    for (const m of await repo.findActiveInvolving(declIds, exceptId)) {
      m.status = S.CLOSED;
      m.closedReason = reason;
      await m.save();
      await repo.addEvent(m._id, E.CLOSED, null, { reason });
      for (const d of [m.lost, m.found]) {
        await notificationService.notify(
          d.owner,
          N.CORRESPONDENCE_CLOSED,
          `A match for "${d.title}" was closed.`,
          m._id,
        );
      }
    }
  }

  return {
    closeForDeclarations,

    async react(user, id, decision, comment) {
      const { c, side, other } = await loadAsParticipant(user, id);
      if ([S.RESOLVED, S.CLOSED].includes(c.status)) {
        throw new ConflictError('This correspondence is already closed');
      }
      if (c.status === S.REFUSED) throw new ConflictError('This correspondence was refused');

      // Case 4: a declaration can have only one accepted match at a time.
      if (decision === D.ACCEPT && (await repo.findAcceptedClash(side, c[side]._id, c._id))) {
        throw new ConflictError(
          'You already accepted another correspondence for this declaration. Refuse it first.',
        );
      }

      const before = c.status;
      c.set(`reactions.${side}`, {
        decision,
        comment: comment ?? null,
        at: new Date(),
        recoveredAt: null,
      });
      c.status = computeStatus(c.reactions);
      await c.save();

      const eventType =
        decision === D.REFUSE
          ? E.REFUSED
          : decision === D.VERIFY
            ? E.VERIFICATION_REQUESTED
            : c.status === S.ACCEPTED
              ? E.ACCEPTED
              : E.ACCEPTED_BY_ONE;
      await repo.addEvent(c._id, eventType, user._id, { side });
      if (comment) await repo.addEvent(c._id, E.FEEDBACK, user._id, { side, comment });
      if (before !== c.status) {
        await repo.addEvent(c._id, E.STATUS_CHANGED, user._id, { from: before, to: c.status });
      }

      const to = c[other].owner;
      if (decision === D.REFUSE) {
        await notificationService.notify(
          to,
          N.CORRESPONDENCE_REFUSED,
          `A match for "${c[other].title}" was refused.`,
          c._id,
        );
      } else if (decision === D.VERIFY) {
        await notificationService.notify(
          to,
          N.VERIFICATION_REQUESTED,
          `More verification is requested for "${c[other].title}".`,
          c._id,
        );
      } else {
        await notificationService.notify(
          to,
          N.CORRESPONDENCE_ACCEPTED,
          c.status === S.ACCEPTED
            ? 'Both sides accepted. Arrange the handover.'
            : 'The other user accepted the match.',
          c._id,
        );
      }
      return c;
    },

    // Case 6: each owner confirms the handover for THEIR OWN declaration, with their own rights.
    // The system never changes a declaration status.
    async markRecovered(user, id) {
      const { c, side, other } = await loadAsParticipant(user, id);
      if (c.status !== S.ACCEPTED) throw new ConflictError('Both sides must accept first');
      if (c.reactions[side].recoveredAt) {
        throw new ConflictError('You already confirmed the recovery');
      }

      // Saved BEFORE the status change: the listener triggered by the change must find this
      // match marked as recovered, so it does not close it.
      c.set(`reactions.${side}.recoveredAt`, new Date());
      await c.save();

      try {
        if (c[side].status !== RESOLVED_STATUS) {
          await declarationService.changeStatus(user, c[side]._id, RESOLVED_STATUS);
        }
      } catch (err) {
        c.set(`reactions.${side}.recoveredAt`, null);
        await c.save();
        throw err;
      }
      await repo.addEvent(c._id, E.RECOVERED, user._id, { side });

      if (c.reactions[other].recoveredAt) {
        c.status = S.RESOLVED;
        await c.save();
        await repo.addEvent(c._id, E.STATUS_CHANGED, user._id, {
          from: S.ACCEPTED,
          to: S.RESOLVED,
        });
        for (const d of [c.lost, c.found]) {
          await notificationService.notify(
            d.owner,
            N.OBJECT_RECOVERED,
            `"${d.title}" was recovered, declaration resolved.`,
            c._id,
          );
        }
      } else {
        await notificationService.notify(
          c[other].owner,
          N.OBJECT_RECOVERED,
          `The other user confirmed the handover of "${c[other].title}". Please confirm on your side.`,
          c._id,
        );
      }

      // The other possible matches of the declaration that was just resolved are closed.
      await closeForDeclarations([c[side]._id], 'object_recovered', c._id);
      return c;
    },

    // Called by the event listeners when a declaration is edited, hidden, deleted, resolved or restored.
    async onDeclarationChanged({ declarationId, changedFields = [] }) {
      const decl = await repo.findDeclaration(declarationId);

      // A resolved declaration closes its other matches, but keeps the one being recovered.
      if (decl && !decl.deletedAt && decl.status === RESOLVED_STATUS) {
        const keep = await repo.findRecoveredMatch(declarationId);
        return closeForDeclarations([declarationId], 'declaration_resolved', keep?._id ?? null);
      }
      if (!decl || decl.deletedAt || OUT_OF_MATCHING_STATUSES.includes(decl.status)) {
        return closeForDeclarations([declarationId], 'declaration_unavailable');
      }
      if (!changedFields.some((f) => RELEVANT_FIELDS.includes(f))) return null;

      // Heavy edit: recompute, then close the untouched proposals that no longer pass.
      const fresh = new Set(
        (await matchingService.findMatches(declarationId)).map((m) => String(m._id)),
      );
      for (const m of await repo.findUntouchedProposals(declarationId)) {
        if (fresh.has(String(m._id))) continue;
        m.status = S.CLOSED;
        m.closedReason = 'score_too_low';
        await m.save();
        await repo.addEvent(m._id, E.CLOSED, null, { reason: 'score_too_low' });
      }
      return null;
    },

    // ---- queries (each returns { correspondence, side, contact }) ----
    async listForDeclaration(user, declarationId) {
      const decl = await repo.findDeclaration(declarationId);
      if (!decl || (String(decl.owner) !== String(user._id) && !isAdminRole(user.role))) {
        throw new NotFoundError('Declaration not found');
      }
      const side = decl.type === DECLARATION_TYPE.LOST ? 'lost' : 'found';
      const list = await repo.listForDeclaration(side, decl._id);
      return Promise.all(list.map((c) => view(user, c)));
    },

    async listMine(user, query) {
      const { items, total } = await repo.listForOwner(user._id, query);
      return { items: await Promise.all(items.map((c) => view(user, c))), total };
    },

    async getOne(user, id) {
      const c = await repo.findByIdPopulated(id);
      if (!c) throw notFound();
      const side = sideOf(c, user);
      if (!side && !isAdminRole(user.role)) throw notFound();
      return { ...(await view(user, c)), history: await repo.getHistory(c._id) };
    },

    async rematch(user, declarationId) {
      const decl = await repo.findDeclaration(declarationId);
      if (!decl) throw new NotFoundError('Declaration not found');
      if (String(decl.owner) !== String(user._id) && !isAdminRole(user.role)) {
        throw new ForbiddenError();
      }
      return (await matchingService.findMatches(declarationId)).length;
    },
  };
}
