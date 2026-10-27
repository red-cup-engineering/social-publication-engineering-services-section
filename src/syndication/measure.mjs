/**
 * The measurement loop: channel readings in, allocation multipliers out.
 *
 * Reach is cheap and easy to fake; an outside response is evidence. The value of a post weights
 * clicks, replies, shares and new followers far above raw views (Group rule: value an evidenced
 * outside response over fictional social reach). Cells with few posts are shrunk toward the global
 * mean and, below a minimum sample, left at 1.0, so one lucky post never starves a channel or a
 * section, and every cell keeps getting tried.
 *
 * MetricReading = { accountId, platform, section, kind, renditionId?, externalId?, at,
 *                   impressions?, views?, likes?, replies?, shares?, clicks?, followersDelta?, watchSeconds? }
 */
export const VALUE_WEIGHTS = Object.freeze({ views: 0.05, impressions: 0.01, likes: 1, replies: 4, shares: 3, clicks: 5, followersDelta: 10 });
export const PRIOR_POSTS = 5;
export const MIN_SAMPLE = 3;
export const MULTIPLIER_RANGE = Object.freeze([0.5, 2]);

export function valueOf(reading) {
  let value = 0;
  for (const [field, weight] of Object.entries(VALUE_WEIGHTS)) value += weight * Math.max(0, Number(reading[field] ?? 0));
  return value;
}

const clamp = (x) => Math.min(MULTIPLIER_RANGE[1], Math.max(MULTIPLIER_RANGE[0], x));

/** Latest reading per post (readings are cumulative counters), then group means. */
export function summarize(readings, dimensions = ['platform', 'section', 'kind']) {
  const latest = new Map();
  for (const reading of readings) {
    const key = reading.renditionId ?? reading.externalId ?? `${reading.accountId}@${reading.at}`;
    const prior = latest.get(key);
    if (!prior || reading.at >= prior.at) latest.set(key, reading);
  }
  const posts = [...latest.values()];
  const total = posts.reduce((sum, reading) => sum + valueOf(reading), 0);
  const globalMean = posts.length === 0 ? 0 : total / posts.length;
  const cells = {};
  for (const dimension of dimensions) {
    const groups = new Map();
    for (const reading of posts) {
      const label = reading[dimension] ?? 'unknown';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(reading);
    }
    cells[dimension] = Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, group]) => {
      const sum = group.reduce((acc, reading) => acc + valueOf(reading), 0);
      const shrunk = (sum + PRIOR_POSTS * globalMean) / (group.length + PRIOR_POSTS);
      const multiplier = group.length < MIN_SAMPLE || globalMean === 0 ? 1 : clamp(shrunk / globalMean);
      return [label, { posts: group.length, meanValue: sum / group.length, shrunkValue: shrunk, multiplier: Number(multiplier.toFixed(3)), clicks: group.reduce((acc, reading) => acc + Number(reading.clicks ?? 0), 0), views: group.reduce((acc, reading) => acc + Number(reading.views ?? 0), 0) }];
    }));
  }
  return { posts: posts.length, globalMean, cells };
}

/** Multiplier for a backlog item that would feed `platforms`, from section and kind cells (geometric mean, so neither dominates). */
export function allocationMultiplier(feedback, { section, kind, platforms = [] }) {
  const factors = [feedback.cells.section?.[section]?.multiplier ?? 1, feedback.cells.kind?.[kind]?.multiplier ?? 1];
  if (platforms.length > 0) factors.push(platforms.reduce((sum, platform) => sum + (feedback.cells.platform?.[platform]?.multiplier ?? 1), 0) / platforms.length);
  return Number(Math.pow(factors.reduce((a, b) => a * b, 1), 1 / factors.length).toFixed(3));
}

/**
 * Readings from a YouTube channel inventory (the Data API upload listing the YouTube section keeps
 * under the house state directory): one reading per public upload.
 */
export function readingsFromYouTubeInventory(inventory, { accountId, section = 'unknown', kindOf = () => 'video' }) {
  return (inventory.uploads ?? []).filter((upload) => upload.status?.privacyStatus === 'public').map((upload) => ({
    accountId, platform: 'youtube', section, kind: kindOf(upload), externalId: upload.id, at: inventory.observedAt,
    views: Number(upload.statistics?.viewCount ?? 0), likes: Number(upload.statistics?.likeCount ?? 0), replies: Number(upload.statistics?.commentCount ?? 0),
    publishedAt: upload.snippet?.publishedAt ?? null, title: upload.snippet?.title ?? null,
  }));
}

/** Plain facts about a channel from its readings: posts, views, views per post, median, and posts over the last `days`. */
export function channelFacts(readings, { nowMs, days = 30 } = {}) {
  const views = readings.map((reading) => Number(reading.views ?? 0)).sort((a, b) => a - b);
  const median = views.length === 0 ? 0 : views[Math.floor(views.length / 2)];
  const recent = nowMs === undefined ? null : readings.filter((reading) => reading.publishedAt && nowMs - Date.parse(reading.publishedAt) <= days * 86_400_000).length;
  return { posts: readings.length, views: views.reduce((a, b) => a + b, 0), viewsPerPost: readings.length === 0 ? 0 : Number((views.reduce((a, b) => a + b, 0) / readings.length).toFixed(1)), medianViews: median, postsInWindow: recent, windowDays: days };
}
