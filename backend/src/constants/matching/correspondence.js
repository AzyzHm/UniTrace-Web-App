export const CORRESPONDENCE_STATUS = Object.freeze({
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted', // both sides accepted
  REFUSED: 'refused',
  TO_VERIFY: 'to_verify',
  RESOLVED: 'resolved', // both owners confirmed the handover
  CLOSED: 'closed', // closed by the system
});
export const CORRESPONDENCE_STATUS_VALUES = Object.values(CORRESPONDENCE_STATUS);

// Still needs attention from the users.
export const ACTIVE_STATUSES = Object.freeze([
  CORRESPONDENCE_STATUS.PROPOSED,
  CORRESPONDENCE_STATUS.TO_VERIFY,
  CORRESPONDENCE_STATUS.ACCEPTED,
]);

export const DECISION = Object.freeze({ ACCEPT: 'accept', REFUSE: 'refuse', VERIFY: 'verify' });
export const DECISION_VALUES = Object.values(DECISION);

export const CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });
export const CONFIDENCE_VALUES = Object.values(CONFIDENCE);

// The history answers "what happened?" when someone comes back days later.
export const MATCH_EVENT_TYPE = Object.freeze({
  CREATED: 'created',
  PROPOSAL_SENT: 'proposal_sent',
  SCORE_UPDATED: 'score_updated',
  ACCEPTED_BY_ONE: 'accepted_by_one',
  ACCEPTED: 'accepted',
  REFUSED: 'refused',
  VERIFICATION_REQUESTED: 'verification_requested',
  FEEDBACK: 'feedback',
  REOPENED: 'reopened',
  STATUS_CHANGED: 'status_changed',
  RECOVERED: 'recovered',
  CLOSED: 'closed',
});
export const MATCH_EVENT_TYPE_VALUES = Object.values(MATCH_EVENT_TYPE);
