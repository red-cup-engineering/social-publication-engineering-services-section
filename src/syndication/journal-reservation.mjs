/**
 * Original journal as the ONE coordination record for outgoing social effects.
 * Exclusive lock + fsynced append is the local Node host's reserve-if-unused.
 * A crashed process leaves its lock or effect-reserved line: both fail closed
 * pending independent reconciliation. No lease expiration or blind retry.
 *
 * This coordinates only the same on-disk journal on one filesystem. A shared
 * remote/distributed host MUST use an equivalent authoritative atomic durable
 * reservation service; copying JSONL between nodes does not provide one.
 */
import { constants, closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { hasSocialEffectAttempt, unresolvedSocialEffects } from './effect-attempt.mjs';
import { niOfJson } from './canonical.mjs';

const lockFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
const appendFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0);

function currentLines(path) {
  if (!existsSync(path)) return [];
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  return rows.map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error('Original social journal contains malformed line ' + (index + 1) + '; refusing effect'); }
  });
}

/**
 * The caller already had to pass the original journal path to runDue. Do not
 * introduce a second ledger, a default path, a background worker or a token.
 * The returned callback is valid for exactly this one local authoritative file.
 */
export function reserveSocialEffectInJournal(journalPath) {
  if (typeof journalPath !== 'string' || !journalPath || !journalPath.endsWith('.jsonl'))
    throw new TypeError('Original journal JSONL path required');
  const lockPath = journalPath + '.preeffect.lock';
  return async (attempt) => {
    // Revalidate the source/shape of the attempted work rather than trusting
    // caller-provided IDs or a decoded journal line.
    if (attempt?.type !== 'SocialPublicationEffectAttempt' || attempt.version !== 1 ||
        typeof attempt.id !== 'string' || !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(attempt.id) ||
        !attempt.accountId || !attempt.renditionId || !attempt.sourceNi ||
        !attempt.releaseRef || typeof attempt.textHash !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(attempt.textHash))
      throw new TypeError('Prepared social effect contract is malformed');
    const { id, ...body } = attempt;
    if (niOfJson(body) !== id)
      throw new TypeError('Prepared effect content does not match its address');
    // If the process is killed with this file held, the next runner refuses.
    // A human must establish the original effect's actual remote outcome and
    // that no writer remains, then explicitly handle the lock.
    const lock = openSync(lockPath, lockFlags, 0o600);
    try {
      const history = currentLines(journalPath);
      if (hasSocialEffectAttempt(history, attempt))
        throw new Error('Original social effect was already reserved or attempted; reconcile before dispatch');
      if (unresolvedSocialEffects(history, attempt).length > 0)
        throw new Error('Prior outbound effect has an unresolved remote outcome; refusing another slot');
      const row = {
        status:'effect-reserved', effectId:attempt.id, accountId:attempt.accountId,
        platform:attempt.platform, renditionId:attempt.renditionId,
        scheduledAt:attempt.scheduledAt, at:new Date().toISOString(),
        sourceNi:attempt.sourceNi, releaseRef:attempt.releaseRef,
        textHash:attempt.textHash,
      };
      const bytes = Buffer.from(JSON.stringify(row) + '\n', 'utf8');
      const journal = openSync(journalPath, appendFlags, 0o600);
      try {
        let written = 0;
        while (written < bytes.length) {
          const count = writeSync(journal, bytes, written, bytes.length - written);
          if (count < 1) throw new Error('Original journal write did not advance');
          written += count;
        }
        fsyncSync(journal);
      } finally { closeSync(journal); }
      return Object.freeze({ reserved:true, effectId:attempt.id });
    } finally { closeSync(lock); unlinkSync(lockPath); }
  };
}
