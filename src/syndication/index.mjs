/**
 * Syndication engine: content item -> per-account renditions -> gated, rate-limited per-account
 * schedule -> publish (dry-run unless live and owner-approved) -> measurement -> allocation signal.
 */
export * from './canonical.mjs';
export * from './platform-rules.mjs';
export * from './accounts.mjs';
export * from './provenance.mjs';
export { planComposition, assertPlanAllowed, renderSvg, ffmpegArgs, cropFor, ALLOWED_OPS, ASPECTS } from './compositor.mjs';
export * from './rendition.mjs';
export * from './gate.mjs';
export * from './schedule.mjs';
export * from './publish.mjs';
export * from './source-currentness.mjs';
export * from './effect-attempt.mjs';
export * from './journal-reservation.mjs';
export * from './measure.mjs';
export { blueskyAdapter, manualPacket } from './adapters.mjs';
export { itemsFromFeed, itemsFromYouTubeInventory } from './sources.mjs';
export * from './editorial.mjs';
export * from './post-provenance.mjs';
export * from './handles.mjs';
export * from './profile-readback.mjs';
export * from './post-readback.mjs';
export * from './rules-evidence.mjs';
