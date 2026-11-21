import {
  ACTIVE_STATUSES,
  CORRESPONDENCE_STATUS as S,
} from '../../constants/matching/correspondence.js';
import {
  DECLARATION_TYPE,
  MATCHABLE_STATUSES,
} from '../../constants/matching/declaration-adapter.js';
import { Declaration } from '../../models/declarations/declaration.model.js';
import { Correspondence } from '../../models/matching/correspondence.model.js';
import { DeclarationEmbedding } from '../../models/matching/declaration-embedding.model.js';
import { MatchEvent } from '../../models/matching/match-event.model.js';

const DAY = 86_400_000;
// Whitelist of populated fields: privateInfo is select:false anyway, and is never listed.
const POPULATE = 'title type category date location picture status owner attributes createdAt';

export function createMatchingRepository() {
  return {
    findDeclaration: (id) => Declaration.findById(id).lean(),

    findCandidates(decl, { MAX_GAP_DAYS, MAX_CANDIDATES }) {
      const t = new Date(decl.date).getTime();
      return Declaration.find({
        type: decl.type === DECLARATION_TYPE.LOST ? DECLARATION_TYPE.FOUND : DECLARATION_TYPE.LOST,
        status: { $in: MATCHABLE_STATUSES },
        deletedAt: null,
        category: decl.category, // hard filter
        owner: { $ne: decl.owner }, // never match with yourself
        date: { $gte: new Date(t - MAX_GAP_DAYS * DAY), $lte: new Date(t + MAX_GAP_DAYS * DAY) },
      })
        .sort({ date: -1 })
        .limit(MAX_CANDIDATES)
        .lean();
    },

    getEmbedding: (declarationId) =>
      DeclarationEmbedding.findOne({ declaration: declarationId }).lean(),
    saveEmbedding(declarationId, { set = {}, unset = {} }) {
      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      return DeclarationEmbedding.updateOne({ declaration: declarationId }, update, {
        upsert: true,
      });
    },

    findPair: (lost, found) => Correspondence.findOne({ lost, found }),
    create: (data) => Correspondence.create(data),
    findByIdPopulated: (id) => Correspondence.findById(id).populate('lost found', POPULATE),

    findActiveInvolving: (declIds, exceptId) =>
      Correspondence.find({
        status: { $in: ACTIVE_STATUSES },
        ...(exceptId && { _id: { $ne: exceptId } }),
        $or: [{ lost: { $in: declIds } }, { found: { $in: declIds } }],
      }).populate('lost found', 'title owner'),

    findUntouchedProposals: (declId) =>
      Correspondence.find({
        status: S.PROPOSED,
        'reactions.lost.decision': null,
        'reactions.found.decision': null,
        $or: [{ lost: declId }, { found: declId }],
      }),

    // Case 4: is another match of this declaration already accepted on this side?
    findAcceptedClash: (side, declId, exceptId) =>
      Correspondence.findOne({
        _id: { $ne: exceptId },
        [side]: declId,
        [`reactions.${side}.decision`]: 'accept',
        status: { $in: ACTIVE_STATUSES },
      }),

    // The match whose handover this declaration's owner already confirmed.
    findRecoveredMatch: (declId) =>
      Correspondence.findOne({
        status: { $in: [S.ACCEPTED, S.RESOLVED] },
        $or: [
          { lost: declId, 'reactions.lost.recoveredAt': { $ne: null } },
          { found: declId, 'reactions.found.recoveredAt': { $ne: null } },
        ],
      }).select('_id'),

    // Best score first (the class diagram note).
    listForDeclaration: (side, declId) =>
      Correspondence.find({ [side]: declId, status: { $ne: S.CLOSED } })
        .sort({ globalScore: -1 })
        .populate('lost found', POPULATE),

    async listForOwner(ownerId, { status, page, limit }) {
      const ids = await Declaration.find({ owner: ownerId }).distinct('_id');
      const filter = { $or: [{ lost: { $in: ids } }, { found: { $in: ids } }] };
      if (status) filter.status = status;
      const [items, total] = await Promise.all([
        Correspondence.find(filter)
          .sort({ globalScore: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('lost found', POPULATE),
        Correspondence.countDocuments(filter),
      ]);
      return { items, total };
    },

    addEvent: (correspondence, type, actor = null, data = {}) =>
      MatchEvent.create({ correspondence, type, actor, data }),
    getHistory: (id) => MatchEvent.find({ correspondence: id }).sort({ createdAt: 1 }).lean(),
  };
}
