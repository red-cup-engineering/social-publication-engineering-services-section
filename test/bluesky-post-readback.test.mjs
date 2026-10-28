import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationIntent, publicationReceipt } from '../src/index.mjs';
import {
  BLUESKY_PUBLIC_POST_ENDPOINT,
  BLUESKY_POST_READBACK_MAX_BYTES,
  admitBlueskyPostExpectation,
  readBlueskyPostReceipt,
} from '../src/syndication/post-readback.mjs';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const cid = 'bafyreiabcdefghijklmnopqrstuvwxyz234567';
const uri = `at://${did}/app.bsky.feed.post/3m5example`;
const now = '2026-10-28T17:00:00Z';
const canonical = 'https://science.561.group/research/exact-edition';
const intent = publicationIntent({
  canonicalUrl: canonical, text: 'A source-grounded release.',
  title: 'Verified release', description: 'Read the underlying evidence.',
});
const receipt = publicationReceipt({provider:'bluesky', intent, externalId:uri, observedAt:now});
const expected = {intent, receipt, publishedCid:cid, repoDid:did};
const post = (overrides = {}) => ({
  uri, cid, author: {did}, record: {
    $type:'app.bsky.feed.post', text:intent.text, createdAt:now,
    embed:{$type:'app.bsky.embed.external',external:{uri:canonical,title:'Verified release',description:''}},
  }, ...overrides,
});
const json = (posts, status = 200) => new Response(JSON.stringify({posts}), {
  status, headers:{'content-type':'application/json'},
});
const read = (posts, options = {}) => readBlueskyPostReceipt(expected, {
  observedAt:now, fetchImpl:async () => json(posts), ...options,
});

test('the expectation is source-, receipt-, author- and CID-bound before the network', async () => {
  const x = admitBlueskyPostExpectation(expected);
  assert.equal(x.repoDid,did);
  assert.equal(x.uri,uri);
  assert.equal(x.intentNi,intent.id);
  let fetched = false;
  const shouldRefuse = async (args) => readBlueskyPostReceipt(args, {
    observedAt:now, fetchImpl:async()=>{fetched=true;throw Error('forbidden');},
  });
  await assert.rejects(shouldRefuse({...expected,repoDid:'did:plc:other'}), /original repository DID/u);
  await assert.rejects(shouldRefuse({...expected, publishedCid:'not-a-cid'}), /original repository DID/u);
  await assert.rejects(shouldRefuse({...expected, receipt:{...receipt,id:'ni:///sha-256;'+'x'.repeat(43)}}), /submission receipt/u);
  await assert.rejects(shouldRefuse({...expected, intent:{...intent,text:'Changed message'}}), /publication intent/u);
  assert.equal(fetched,false);
});

test('a public exact record yields narrow independent AppView evidence, not delivery', async () => {
  let request;
  const observation = await read([post()], {fetchImpl:async (url,init)=>{
    request={url,init}; return json([post()]);
  }});
  assert.equal(request.url,BLUESKY_PUBLIC_POST_ENDPOINT+'?uris='+encodeURIComponent(uri));
  assert.equal(request.init.method,'GET');
  assert.equal(request.init.credentials,'omit');
  assert.equal(request.init.redirect,'manual');
  assert.equal(request.init.headers.authorization,undefined);
  assert.equal(observation.standing,'public-record-match');
  assert.equal(observation.canonicalLinkCarriedBy,'external-card');
  assert.equal(observation.observedCid,cid);
  assert.equal(observation.verifiedCompletion,false);
  assert.equal(observation.readOnly,true);
  assert.equal(Object.hasOwn(observation,'views'),false);
  assert.equal(Object.hasOwn(observation,'impressions'),false);
});

test('visible exact text link works when no external card exists, without substring matching', async () => {
  const source = publicationIntent({canonicalUrl:canonical,text:`Full original: ${canonical}`});
  const submitted = publicationReceipt({provider:'bluesky',intent:source,externalId:uri,observedAt:now});
  const input={intent:source,receipt:submitted,publishedCid:cid,repoDid:did};
  const raw={...post(), record:{$type:'app.bsky.feed.post',text:source.text,createdAt:now}};
  const found=await readBlueskyPostReceipt(input,{observedAt:now,fetchImpl:async()=>json([raw])});
  assert.equal(found.standing,'public-record-match');
  assert.equal(found.canonicalLinkCarriedBy,'visible-text');
  const different=publicationIntent({canonicalUrl:canonical,text:`Misleading: ${canonical}-elsewhere`});
  const differentReceipt=publicationReceipt({provider:'bluesky',intent:different,externalId:uri,observedAt:now});
  const fake=await readBlueskyPostReceipt({intent:different,receipt:differentReceipt,publishedCid:cid,repoDid:did},
    {observedAt:now,fetchImpl:async()=>json([{...post(),record:{$type:'app.bsky.feed.post',text:different.text,createdAt:now}}])});
  assert.equal(fake.standing,'source-link-missing');
});

test('replaced CID, wrong DID, changed copy and missing canonical link are not successes', async () => {
  assert.equal((await read([post({cid:'bafyreidifferentabcdefghi234567'})])).standing,'revision-conflict');
  assert.equal((await read([post({author:{did:'did:plc:anotheraccount'}})])).standing,'identity-conflict');
  assert.equal((await read([post({uri:uri+'/wrong'})])).standing,'identity-conflict');
  assert.equal((await read([post({record:{...post().record,text:'Changed words'}})])).standing,'content-conflict');
  assert.equal((await read([post({record:{...post().record,embed:undefined}})])).standing,'source-link-missing');
});

test('empty AppView results mean not-observed, not deleted or zero impressions', async () => {
  const result=await read([]);
  assert.equal(result.standing,'not-observed');
  assert.ok(!Object.hasOwn(result,'impressions'));
  assert.ok(!Object.hasOwn(result,'deleted'));
});

test('malformed result, duplicate posts, invalid record and HTTP failures fail closed', async () => {
  assert.equal((await read([post(),post()])).standing,'unavailable');
  assert.equal((await read([post({record:{text:intent.text}})])).standing,'unavailable');
  for(const response of [
    new Response('',{status:429}),
    new Response('not json',{status:200,headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({posts:[post()]}),{status:200,headers:{'content-type':'text/html'}}),
    new Response(JSON.stringify({posts:[post()]}),{status:302}),
  ]) {
    const observed=await read([], {fetchImpl:async()=>response});
    assert.equal(observed.standing,'unavailable');
  }
});

test('bounded public responses refuse an excessive declared or streamed payload', async () => {
  const declared=await read([],{fetchImpl:async()=>new Response('{}',{
    status:200,headers:{'content-type':'application/json','content-length':String(BLUESKY_POST_READBACK_MAX_BYTES+1)},
  })});
  assert.equal(declared.standing,'unavailable');
  const over=await read([],{fetchImpl:async()=>new Response(JSON.stringify({posts:[],padding:'a'.repeat(BLUESKY_POST_READBACK_MAX_BYTES)}),{
    headers:{'content-type':'application/json'},
  })});
  assert.equal(over.standing,'unavailable');
});

test('observation timestamp and fetch must be supplied with an unambiguous UTC reading', async () => {
  await assert.rejects(readBlueskyPostReceipt(expected,{observedAt:'yesterday',fetchImpl:async()=>json([post()])}),/exact UTC/u);
  await assert.rejects(readBlueskyPostReceipt(expected,{observedAt:now,fetchImpl:null}),/fetch function/u);
});
