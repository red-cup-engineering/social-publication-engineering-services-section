/**
 * Post adapters. The only live adapter shipped is Bluesky, built on the section's existing
 * credential-blind suppliers (publicationIntent, blueskyPostRecord, uploadBlueskyBlob,
 * publishBlueskyPost); no second API client is introduced. Facebook Page and LinkedIn suppliers
 * exist in index.mjs and are wired the same way when an account for them is admitted. Every other
 * platform is either manual (a packet a person posts, see manualPacket) or not installed; the
 * runner refuses to post where no adapter is installed.
 */
import { blueskyPostRecord, publicationIntent, publishBlueskyPost, uploadBlueskyBlob } from '../index.mjs';

const statusOf = (error) => {
  if (error?.status) return Number(error.status);
  const match = /\b([1-5]\d{2})\b/u.exec(String(error?.message ?? ''));
  return match ? Number(match[1]) : 0;
};

/**
 * @param {object} options
 * @param {(ni:string) => Promise<Uint8Array>} options.loadBytes   fetches image bytes for a media address (host-supplied)
 * @param {(rendition) => string} [options.langOf]
 */
export function blueskyAdapter({ loadBytes, service = 'https://bsky.social' } = {}) {
  return Object.freeze({
    platform: 'bluesky', live: true,
    validate(rendition, account) {
      const problems = [];
      if (!/^did:/u.test(account.did ?? '')) problems.push('the account record carries no public did');
      if (rendition.media.some((media) => media.as === 'video')) problems.push('video upload is not wired for Bluesky yet; post the link');
      if (rendition.media.some((media) => media.as === 'image') && typeof loadBytes !== 'function') problems.push('image bytes loader missing');
      return { ok: problems.length === 0, problems };
    },
    async publish(rendition, { account, authorizedFetch }) {
      try {
        const intent = publicationIntent({ canonicalUrl: rendition.link, text: rendition.text, title: rendition.title ?? undefined, languages: [rendition.language ?? 'en'], kind: 'article' });
        let externalThumb;
        const image = rendition.media.find((media) => media.as === 'image');
        if (image) externalThumb = await uploadBlueskyBlob({ authorizedFetch, service, bytes: await loadBytes(image.ni), mediaType: image.mediaType });
        const record = blueskyPostRecord({
          intent, createdAt: new Date().toISOString(),
          externalCard: { uri: rendition.link, title: rendition.title ?? intent.title ?? rendition.link, description: image?.alt ?? '' },
          externalThumb,
        });
        const receipt = await publishBlueskyPost({ authorizedFetch, service, repoDid: account.did, record });
        return { externalId: receipt.uri, url: `https://bsky.app/profile/${account.handle}/post/${receipt.uri.split('/').pop()}` };
      } catch (error) {
        const wrapped = new Error(error.message);
        wrapped.status = statusOf(error);
        throw wrapped;
      }
    },
  });
}

/**
 * A manual packet: everything a person needs to post by hand on a platform that does not admit
 * automation, with the checklist of what that platform expects. Not an adapter: no network.
 */
export function manualPacket(rendition, account, rule, scheduledFor) {
  return {
    type: 'ManualPostingPacket', renditionId: rendition.id, account: account.id, handle: account.handle, platform: account.platform,
    scheduledFor, title: rendition.title, text: rendition.text, link: rendition.link,
    media: rendition.media.map((media) => ({ ni: media.ni, as: media.as, alt: media.alt, aspect: media.aspect })),
    aiDisclosure: rendition.disclosure, verifyUrl: rendition.provenance.verifyUrl,
    checklist: [
      `Read ${account.platform}'s current rules for this community before posting: ${rule.automation.note}`,
      rendition.disclosure.applied ? `Use the platform's AI-content label${rule.aiDisclosure.offered ? ' (offered by the platform)' : ''} and keep the disclosure line in the text.` : 'No AI-generated media attached.',
      'Do not ask for votes, reposts or follows. Do not post the same item to several communities at once.',
      'After posting, record the URL with `syndicate record-manual` so measurement can read it.',
    ],
  };
}
