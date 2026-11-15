import { EVENT, SIDE } from '../constants/matching.constants.js';

const sid = (x) => (x === null || x === undefined ? null : String(x));

const plain = (m) => (typeof m.toObject === 'function' ? m.toObject() : m);

/** Human-readable sentence for one history event (what an admin reads days later). */
function describeEvent(e, { actor }) {
  const who =
    actor === 'you'
      ? 'You'
      : actor === 'other'
        ? 'The other user'
        : actor === 'system'
          ? 'The system'
          : 'An administrator';
  const d = e.data || {};
  switch (e.type) {
    case EVENT.CREATED:
      return `Match created by the system (score ${d.score}, confidence ${d.confidence})`;
    case EVENT.PROPOSAL_SENT:
      return 'Proposal sent to both users';
    case EVENT.ACCEPTED:
      return `${who} accepted the match`;
    case EVENT.REJECTED:
      return `${who} rejected the match`;
    case EVENT.NEEDS_INFO_REQUESTED:
      return `${who} asked for more information`;
    case EVENT.FEEDBACK:
      return `${who} left feedback: ${d.text}`;
    case EVENT.STATUS_CHANGED:
      return `Status changed from ${d.from} to ${d.to}`;
    case EVENT.RESCORED:
      return `Match rescored after a change (${d.from} -> ${d.to})`;
    case EVENT.REOPENED:
      return `Match reopened after new information (score ${d.previousScore} -> ${d.newScore})`;
    case EVENT.DISPUTE_DETECTED:
      return `Several users claim the same found object (${d.competingMatches} claims)`;
    case EVENT.DISPUTE_CLEARED:
      return 'Dispute cleared';
    case EVENT.DECLARATION_EDITED:
      return `${who} edited the declaration after the match was confirmed`;
    case EVENT.CLOSED:
      return `Match closed: ${String(d.reason || '').replace(/_/g, ' ')}`;
    case EVENT.RECOVERED:
      return `${who} declared the object recovered`;
    default:
      return e.type;
  }
}

const SIGNAL_LABEL = {
  text: 'similar description',
  location: 'same place',
  color: 'same color',
  brand: 'same brand',
  date: 'close dates',
  photo: 'similar photo',
};

/** "Why was this proposed?" in words, without exposing raw numbers to normal users. */
function reasons(breakdown) {
  const signals = (breakdown && breakdown.signals) || {};
  return Object.entries(signals)
    .filter(([, s]) => s && s.value !== null && s.value >= 0.7)
    .map(([name]) => SIGNAL_LABEL[name]);
}

function summarize(decl) {
  if (!decl) return null;
  // no owner id, no contact: contact details only after confirmation (out of this module)
  return {
    id: decl.id,
    type: decl.type,
    title: decl.title,
    description: decl.description,
    category: decl.category,
    color: decl.color,
    zone: decl.zone,
    date: decl.date,
    photo: decl.photo,
  };
}

/**
 * @param {object} match   Match document
 * @param {object} viewer  { id, isAdmin }
 * @param {object} [decls] { lost, found } matchable declarations (optional)
 */
function toMatchDTO(match, viewer, decls) {
  const m = plain(match);
  const viewerId = sid(viewer.id);
  const side =
    sid(m.lostOwnerId) === viewerId
      ? SIDE.LOST
      : sid(m.foundOwnerId) === viewerId
        ? SIDE.FOUND
        : null;
  const otherSide = side === SIDE.LOST ? SIDE.FOUND : SIDE.LOST;

  const actorOf = (e) => {
    if (!e.actorId) return 'system';
    if (viewer.isAdmin && !side) return 'admin';
    return sid(e.actorId) === viewerId ? 'you' : 'other';
  };

  const dto = {
    id: sid(m._id || m.id),
    status: m.status,
    confidence: m.confidence,
    ambiguous: !!m.ambiguous,
    disputed: !!m.disputed,
    reasons: reasons(m.breakdown),
    yourSide: side,
    yourResponse: side ? m.responses[side].value : null,
    // the other user's decision is only shown once it is an answer, not their free-text feedback
    otherResponse: side ? m.responses[otherSide].value : null,
    closedReason: m.closedReason || null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    history: (m.events || []).map((e) => ({
      type: e.type,
      at: e.at,
      description: describeEvent(e, { actor: actorOf(e) }),
    })),
  };

  if (decls) {
    const mine = side === SIDE.LOST ? decls.lost : side === SIDE.FOUND ? decls.found : null;
    const other = side === SIDE.LOST ? decls.found : side === SIDE.FOUND ? decls.lost : null;
    dto.yourDeclaration = summarize(mine);
    dto.otherDeclaration = summarize(other);
    if (viewer.isAdmin && !side) {
      dto.lostDeclaration = summarize(decls.lost);
      dto.foundDeclaration = summarize(decls.found);
    }
  }

  if (viewer.isAdmin) {
    dto.score = m.score;
    dto.breakdown = m.breakdown;
    dto.lostOwnerId = sid(m.lostOwnerId);
    dto.foundOwnerId = sid(m.foundOwnerId);
    dto.lostDeclarationId = sid(m.lostDeclarationId);
    dto.foundDeclarationId = sid(m.foundDeclarationId);
    dto.responses = m.responses;
  }
  return dto;
}

export { toMatchDTO, describeEvent, reasons };
