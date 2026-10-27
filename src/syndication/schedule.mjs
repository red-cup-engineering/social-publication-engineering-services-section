/**
 * Scheduling: per-account queues, each planned independently against its platform's posting
 * windows and rate limits and its own timezone. One account's hold, error or empty queue never
 * changes another account's plan. Deterministic: slots are derived from the account id, never
 * from a random source or the wall clock.
 *
 * Slot rule: inside each posting window the first slot is the window start plus a stagger of 0..44
 * minutes derived from the account id (so two accounts on one platform do not fire together),
 * later slots follow at the effective minimum gap, never exceeding perHour or perDay (counting
 * posts already in the journal) and never exceeding a platform-wide daily cap.
 */
import { createHash } from 'node:crypto';
import { automationAdmission, ruleFor } from './platform-rules.mjs';
import { effectiveLimits, isPostable } from './accounts.mjs';
import { iso } from './canonical.mjs';

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map();
function localParts(ms, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), weekday };
}

const staggerMinutes = (accountId) => createHash('sha256').update(accountId).digest()[0] % 45;

/** Candidate instants (ms) of one account over [startMs, startMs + days), in window order. */
export function slotsFor(account, rule, { startMs, days, journalTimes = [] }) {
  const limits = effectiveLimits(rule, account);
  // The platform's limits are hard caps; the cadence is how loud we choose to be inside them.
  const cap = Math.max(1, Math.min(limits.perDay, rule.cadence?.targetPerDay ?? Infinity, account.cadence?.targetPerDay ?? Infinity));
  const stagger = staggerMinutes(account.id);
  const slots = [];
  const perDay = new Map();
  for (const t of journalTimes) { const day = localParts(t, account.timezone).day; perDay.set(day, (perDay.get(day) ?? 0) + 1); }
  let last = Math.max(-Infinity, ...journalTimes);
  const end = startMs + days * DAY;
  // Walk in 15-minute steps; take a step when it is the window's staggered opening or a gap-spaced follow-up.
  for (let t = Math.ceil(startMs / (15 * MINUTE)) * 15 * MINUTE; t < end; t += 15 * MINUTE) {
    const local = localParts(t, account.timezone);
    const window = rule.windows.find((entry) => entry.days.includes(local.weekday) && local.hour >= entry.startHour && local.hour < entry.endHour);
    if (!window) continue;
    const minutesIntoWindow = (local.hour - window.startHour) * 60 + local.minute;
    if (minutesIntoWindow < stagger) continue;
    // Spread the day's posts across the window instead of packing them at its opening.
    const spacing = Math.max(limits.minGapMinutes, Math.floor(((window.endHour - window.startHour) * 60) / cap));
    if (t - last < spacing * MINUTE) continue;
    if ((perDay.get(local.day) ?? 0) >= cap) continue;
    const hourAgo = [...slots, ...journalTimes].filter((s) => t - s < 60 * MINUTE).length;
    if (hourAgo >= limits.perHour) continue;
    slots.push(t);
    perDay.set(local.day, (perDay.get(local.day) ?? 0) + 1);
    last = t;
  }
  return slots;
}

/**
 * @param {object} input
 * @param {object[]} input.renditions   gated or not; scheduling does not post
 * @param {object} input.registry       admitted AccountRegistry
 * @param {object} input.ruleSet
 * @param {number} input.startMs
 * @param {number} input.days
 * @param {object[]} [input.journal]    prior entries { accountId, at, status } so a plan continues, not restarts
 * @returns {{entries: object[], accounts: object}}
 */
export function planSchedule({ renditions, registry, ruleSet, startMs, days, journal = [] }) {
  const entries = [];
  const accounts = {};
  const platformDaily = new Map();
  for (const account of registry.accounts) {
    const summary = { scheduled: 0, held: 0, manual: 0, unscheduled: 0, error: null };
    accounts[account.id] = summary;
    try {
      const queue = renditions.filter((rendition) => rendition.accountId === account.id).sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
      if (queue.length === 0) continue;
      const rule = ruleFor(ruleSet, account.platform);
      const admission = automationAdmission(rule, account);
      const state = isPostable(account) ? null : `account ${account.state}${account.hold ? `: ${account.hold.reason}` : ''}`;
      const journalTimes = journal.filter((entry) => entry.accountId === account.id && entry.status === 'posted').map((entry) => Date.parse(entry.at));
      const slots = slotsFor(account, rule, { startMs, days, journalTimes });
      for (const [index, rendition] of queue.entries()) {
        const slot = slots[index];
        if (slot === undefined) { summary.unscheduled += 1; entries.push({ renditionId: rendition.id, accountId: account.id, platform: account.platform, at: null, status: 'unscheduled', reason: 'no free slot in the planning horizon' }); continue; }
        const dayKey = `${account.platform}:${iso(slot).slice(0, 10)}`;
        const cap = rule.limits.perPlatform?.perDay;
        if (cap !== undefined && (platformDaily.get(dayKey) ?? 0) >= cap) { summary.unscheduled += 1; entries.push({ renditionId: rendition.id, accountId: account.id, platform: account.platform, at: null, status: 'unscheduled', reason: `platform-wide daily cap of ${cap} reached` }); continue; }
        platformDaily.set(dayKey, (platformDaily.get(dayKey) ?? 0) + 1);
        let status = 'scheduled';
        let reason = null;
        if (account.state === 'planned') { status = 'awaiting-account'; reason = 'account planned: not created or not yet approved for use'; summary.held += 1; }
        else if (state) { status = 'held'; reason = state; summary.held += 1; }
        else if (!admission.automated) { status = 'manual'; reason = admission.reason; summary.manual += 1; }
        else summary.scheduled += 1;
        entries.push({
          renditionId: rendition.id, accountId: account.id, platform: account.platform, at: iso(slot), status, reason,
          requiresOwnerApproval: !account.approval.firstPostApprovedAt,
        });
      }
    } catch (error) {
      summary.error = error.message;
    }
  }
  entries.sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9') || a.accountId.localeCompare(b.accountId));
  return { entries, accounts };
}

/** Entries whose time has come and which are not held, manual or unscheduled. */
export const dueEntries = (entries, nowMs) => entries.filter((entry) => entry.status === 'scheduled' && Date.parse(entry.at) <= nowMs);

/** Check a prospective post time against the journal: the limits that bind right now. */
export function limitCheck(account, rule, journal, nowMs) {
  const limits = effectiveLimits(rule, account);
  const posted = journal.filter((entry) => entry.accountId === account.id && entry.status === 'posted').map((entry) => Date.parse(entry.at));
  const lastHour = posted.filter((t) => nowMs - t < 60 * MINUTE).length;
  const today = posted.filter((t) => localParts(t, account.timezone).day === localParts(nowMs, account.timezone).day).length;
  const sinceLast = posted.length === 0 ? Infinity : nowMs - Math.max(...posted);
  const reasons = [];
  if (lastHour >= limits.perHour) reasons.push(`perHour ${limits.perHour} reached`);
  if (today >= limits.perDay) reasons.push(`perDay ${limits.perDay} reached`);
  if (sinceLast < limits.minGapMinutes * MINUTE) reasons.push(`minimum gap of ${limits.minGapMinutes} minutes not elapsed`);
  const local = localParts(nowMs, account.timezone);
  if (!rule.windows.some((window) => window.days.includes(local.weekday) && local.hour >= window.startHour && local.hour < window.endHour)) reasons.push('outside the posting window');
  return { ok: reasons.length === 0, reasons };
}
