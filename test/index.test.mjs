import test from "node:test";
import assert from "node:assert/strict";
import {
  blueskyPostRecord,
  niDigest,
  observeFacebookPage,
  publicationIntent,
  publicationReceipt,
  publishBlueskyPost,
  publishFacebookPagePost,
  resolveBlueskyHandle,
  uploadBlueskyBlob,
} from "../src/index.mjs";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("publication intents and receipts are ni-addressed and deterministic", () => {
  const intent = publicationIntent({ canonicalUrl: "https://koios.news/posts/example", text: "A quiet update.", title: "Example", description: "Evidence first." });
  assert.match(intent.id, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]+$/u);
  assert.equal(intent.id, publicationIntent({ canonicalUrl: "https://koios.news/posts/example", text: "A quiet update.", title: "Example", description: "Evidence first." }).id);
  const receipt = publicationReceipt({ provider: "bluesky", intent, externalId: "at://did:plc:abc/app.bsky.feed.post/xyz", observedAt: "2026-10-06T00:00:00Z" });
  assert.match(receipt.id, /^ni:\/\/\/sha-256;/u);
  assert.equal(niDigest({ b: 2, a: 1 }), niDigest({ a: 1, b: 2 }));
});

test("Bluesky post creation is credential-blind and exact-receipt checked", async () => {
  const intent = publicationIntent({ canonicalUrl: "https://koios.news/posts/example", text: "Watching the future take shape.", title: "Example", description: "The record changed." });
  const record = blueskyPostRecord({ intent, createdAt: "2026-10-06T01:02:03Z", externalCard: {} });
  let seen;
  const result = await publishBlueskyPost({
    repoDid: "did:plc:abcdefghijklmnop",
    record,
    authorizedFetch: async (url, init) => {
      seen = { url, init };
      return response({ uri: "at://did:plc:abcdefghijklmnop/app.bsky.feed.post/3abc", cid: "bafyrei0123456789" });
    },
  });
  assert.equal(seen.url, "https://bsky.social/xrpc/com.atproto.repo.createRecord");
  assert.equal(seen.init.headers.authorization, undefined);
  assert.match(seen.init.body, /app\.bsky\.feed\.post/u);
  assert.equal(result.cid, "bafyrei0123456789");
});

test("Bluesky blob upload stays bounded and returns a validated blob", async () => {
  const blob = await uploadBlueskyBlob({
    bytes: new Uint8Array([1,2,3,4]),
    authorizedFetch: async () => response({ blob: { $type: "blob", ref: { $link: "bafkabc" }, mimeType: "image/png", size: 4 } }),
  });
  assert.equal(blob.ref.$link, "bafkabc");
});

test("Bluesky handle resolution is public and provider-independent", async () => {
  const value = await resolveBlueskyHandle({ handle: "koios.news", fetch: async () => response({ did: "did:plc:abcdefghijklmnop" }) });
  assert.equal(value.did, "did:plc:abcdefghijklmnop");
});

test("Facebook Page observation and publication require explicit API version and page identity", async () => {
  const calls=[];
  const authorizedFetch=async (url, init) => {
    calls.push({url,init});
    if (init.method === "GET") return response({ id: "61573083309686", name: "Koios.News", link: "https://www.facebook.com/koios.news" });
    return response({ id: "61573083309686_123456789" });
  };
  const page=await observeFacebookPage({ authorizedFetch, apiVersion:"v24.0", pageId:"61573083309686" });
  assert.equal(page.name,"Koios.News");
  const post=await publishFacebookPagePost({ authorizedFetch, apiVersion:"v24.0", pageId:"61573083309686", message:"Watching the future take shape.", link:"https://koios.news/" });
  assert.equal(post.id,"61573083309686_123456789");
  assert.equal(calls[1].init.headers.authorization, undefined);
  assert.match(calls[1].init.body,/koios\.news/u);
});
