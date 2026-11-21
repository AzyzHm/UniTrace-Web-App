import crypto from 'node:crypto';
import {
  CORRESPONDENCE_STATUS as S,
  MATCH_EVENT_TYPE as E,
} from '../../constants/matching/correspondence.js';
import {
  DECLARATION_TYPE,
  MATCHABLE_STATUSES,
} from '../../constants/matching/declaration-adapter.js';
import { MATCHING_CONFIG } from '../../constants/matching/matching-config.js';
import { NOTIFICATION_TYPE as N } from '../../constants/notifications/notification.js';
import { calculateScore, passesThreshold } from './scoring.js';
import { buildEmbeddingText } from './text-normalizer.js';

const EMPTY_REACTIONS = () => ({
  lost: { decision: null, comment: null, at: null },
  found: { decision: null, comment: null, at: null },
});

export function createMatchingService({
  matchingRepository: repo,
  embeddingService,
  notificationService,
  logger,
  config = MATCHING_CONFIG,
}) {
  if (!repo || !embeddingService || !notificationService || !logger) {
    throw new Error(
      'createMatchingService(): matchingRepository, embeddingService, notificationService and logger are required',
    );
  }

  // vectoriser(declaration): recompute only what changed (text hash, picture filename).
  async function vectorize(decl) {
    const text = buildEmbeddingText(decl);
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    const emb = await repo.getEmbedding(decl._id);
    const set = {};
    const unset = {};

    if (!emb?.textVector?.length || emb.textHash !== hash) {
      set.textVector = await embeddingService.embedText(text);
      set.textHash = hash;
    }
    if (decl.picture && emb?.imageSource !== decl.picture) {
      try {
        set.imageVector = await embeddingService.embedImage(decl.picture);
        set.imageSource = decl.picture;
      } catch (err) {
        logger.warn(
          { err, declaration: String(decl._id) },
          'Image embedding failed, picture signal skipped',
        );
      }
    } else if (!decl.picture && emb?.imageVector?.length) {
      unset.imageVector = 1;
      unset.imageSource = 1;
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await repo.saveEmbedding(decl._id, { set, unset });
    }

    return {
      declaration: decl,
      textVector: set.textVector ?? emb.textVector,
      imageVector: unset.imageVector ? undefined : (set.imageVector ?? emb?.imageVector),
    };
  }

  // notifier()
  async function notifyProposal(c, lost, found) {
    const text = (title) =>
      `A possible match was found for "${title}" (confidence: ${c.confidence}).`;
    await notificationService.notify(lost.owner, N.NEW_CORRESPONDENCE, text(lost.title), c._id);
    await notificationService.notify(found.owner, N.NEW_CORRESPONDENCE, text(found.title), c._id);
    await repo.addEvent(c._id, E.PROPOSAL_SENT);
  }

  // creerCorrespondance()
  async function upsertCorrespondence(lost, found, score) {
    const existing = await repo.findPair(lost._id, found._id);

    if (!existing) {
      let c;
      try {
        c = await repo.create({ lost: lost._id, found: found._id, ...score });
      } catch (err) {
        if (err.code === 11000) return null; // a parallel run created it first
        throw err;
      }
      await repo.addEvent(c._id, E.CREATED, null, { globalScore: score.globalScore });
      await notifyProposal(c, lost, found);
      return c;
    }

    if ([S.RESOLVED, S.CLOSED].includes(existing.status)) return null;

    // Case 3: a refused match comes back only when the new score is clearly better.
    if (existing.status === S.REFUSED) {
      if (score.globalScore < existing.globalScore + config.REOPEN_DELTA) return null;
      const previous = existing.globalScore;
      Object.assign(existing, score, { status: S.PROPOSED, reactions: EMPTY_REACTIONS() });
      await existing.save();
      await repo.addEvent(existing._id, E.REOPENED, null, { previous, current: score.globalScore });
      await notifyProposal(existing, lost, found);
      return existing;
    }

    // Active match: refresh the scores.
    const moved = Math.abs(existing.globalScore - score.globalScore) > 0.01;
    Object.assign(existing, score);
    await existing.save();
    if (moved)
      await repo.addEvent(existing._id, E.SCORE_UPDATED, null, { globalScore: score.globalScore });
    return existing;
  }

  return {
    vectorize,

    // preselectionner, calculerScore, appliquerSeuil, creerCorrespondance for one declaration.
    async findMatches(declarationId) {
      const decl = await repo.findDeclaration(declarationId);
      if (!decl || decl.deletedAt || !MATCHABLE_STATUSES.includes(decl.status)) return [];

      const isLost = decl.type === DECLARATION_TYPE.LOST;
      const mine = await vectorize(decl);

      const scored = [];
      for (const candidate of await repo.findCandidates(decl, config)) {
        try {
          const other = await vectorize(candidate);
          const score = calculateScore(isLost ? mine : other, isLost ? other : mine, config);
          if (passesThreshold(score, config)) scored.push({ candidate, score });
        } catch (err) {
          // One broken candidate must not stop the others.
          logger.warn({ err, candidate: String(candidate._id) }, 'Candidate skipped');
        }
      }
      scored.sort((a, b) => b.score.globalScore - a.score.globalScore); // case 2: best first

      const created = [];
      for (const { candidate, score } of scored.slice(0, config.MAX_MATCHES_PER_DECLARATION)) {
        const c = await upsertCorrespondence(
          isLost ? decl : candidate,
          isLost ? candidate : decl,
          score,
        );
        if (c) created.push(c);
      }
      logger.info({ declaration: String(declarationId), matches: created.length }, 'Matching done');
      return created;
    },
  };
}
