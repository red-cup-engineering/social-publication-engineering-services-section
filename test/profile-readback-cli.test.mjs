import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../apps/brand-presence.mjs',import.meta.url));
const desired='Four organizations building institutions: research, engineering, operations and public services. We publish what is done and what is only planned. Operated by Morgan Sennhauser. Posts are drafted by AI agents.';
const old='Source formerly displayed another public description';
const did='did:plc:wpmzbzu62jkeapaptmv7lr5i';
const ni=text=>'ni:///sha-256;'+createHash('sha256').update(text,'utf8').digest('base64url');
const currentDate='2026-10-27T18:10:00Z';
const fixture=t=>{
  const root=mkdtempSync(join(tmpdir(),'source-brand-profile-cli-'));
  t.after(()=>rmSync(root,{force:true,recursive:true}));
  const path=join(root,'original-copy-record.json');
  const record={
    id:'2026-10-25-bluesky-561-group-profile-text',kind:'public-copy',
    brand:'561-group',platform:'bluesky',field:'description (profile bio)',
    account:'@561.group ('+did+')',
    observed:{source:'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=561.group',
      text:old,textNi:ni(old)},
    options:[
      {id:'keep-current',candidate:{type:'CopyCandidate',brand:'561-group',
        platform:'bluesky',field:'description',text:old},gate:{pass:false}},
      {id:'new-copy',candidate:{type:'CopyCandidate',brand:'561-group',
        platform:'bluesky',field:'description',text:desired},
        gate:{pass:true,report:{textNi:ni(desired)}}}],
    chosen:{id:'new-copy',textNi:ni(desired)}
  };
  const contents=JSON.stringify(record,null,2)+'\n';
  writeFileSync(path,contents);
  return {root,path,contents};
};
const preload=[
  "globalThis.fetch=async (url,options)=>{",
  "  const expected='https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=561.group';",
  "  if(url!==expected || options.method!=='GET' || options.redirect!=='manual' || options.credentials!=='omit')",
  "    throw new TypeError('Wrong source or transport');",
  "  if(process.env.PROFILE_API_STATE==='unavailable')throw Error('PROVIDER-PRIVATE-DO-NOT-LEAK');",
  "  const previous='Source formerly displayed another public description';",
  "  const chosen='Four organizations building institutions: research, engineering, operations and public services. We publish what is done and what is only planned. Operated by Morgan Sennhauser. Posts are drafted by AI agents.';",
  "  const status=process.env.PROFILE_API_STATE;",
  "  return Response.json({",
  "    did:status==='identity-conflict'?'did:plc:other':'did:plc:wpmzbzu62jkeapaptmv7lr5i',",
  "    handle:'561.group',",
  "    description:status==='matched'?chosen:status==='prior'?previous:'Different public copy'",
  "  });",
  "};"
].join('\n');
const preloadUri='data:text/javascript;base64,'+Buffer.from(preload).toString('base64');
const run=(path,state)=>{
  const result=spawnSync(process.execPath,['--import',preloadUri,cli,
    'profile-readback',path,'--now',currentDate],{
    encoding:'utf8',timeout:20_000,env:{...process.env,PROFILE_API_STATE:state},
  });
  if(result.error)throw result.error;
  return result;
};

test('native brand-presence CLI receives exact matching AppView source reading',t=>{
  const f=fixture(t),result=run(f.path,'matched');
  assert.equal(result.status,0,result.stderr);
  const body=JSON.parse(result.stdout);
  assert.equal(body.standing,'text-match');
  assert.equal(body.verifiedCompletion,false);
  assert.equal(body.expectedNi,ni(desired));
  assert.equal(body.observedNi,ni(desired));
  assert.equal(body.observedAt,new Date(currentDate).toISOString());
  assert.equal(readFileSync(f.path,'utf8'),f.contents);
  assert.deepEqual(readdirSync(f.root),['original-copy-record.json']);
});
test('native CLI distinguishes previous public copy from verified completion',t=>{
  const f=fixture(t),result=run(f.path,'prior');
  assert.equal(result.status,3);
  const body=JSON.parse(result.stdout);
  assert.equal(body.standing,'previous-text-visible');
  assert.equal(body.verifiedCompletion,false);
  assert.equal(body.observedNi,ni(old));
  assert.deepEqual(readdirSync(f.root),['original-copy-record.json']);
});
test('native CLI refuses mismatched pinned account DID',t=>{
  const f=fixture(t),result=run(f.path,'identity-conflict');
  assert.equal(result.status,3);
  const body=JSON.parse(result.stdout);
  assert.equal(body.standing,'identity-conflict');
  assert.equal(Object.hasOwn(body,'publicDescription'),false);
});
test('native CLI redacts provider failure without creating a false empty observation',t=>{
  const f=fixture(t),result=run(f.path,'unavailable');
  assert.equal(result.status,3);
  const body=JSON.parse(result.stdout);
  assert.equal(body.standing,'unavailable');
  assert.equal(body.reason,'public-source-unavailable');
  assert.equal(result.stderr.includes('PROVIDER-PRIVATE-DO-NOT-LEAK'),false);
  assert.equal(readFileSync(f.path,'utf8'),f.contents);
});
test('native CLI refuses tampered source decision without overwriting its source bytes',t=>{
  const f=fixture(t),doc=JSON.parse(f.contents);
  doc.chosen.textNi=ni('a made-up candidate');
  const tampered=JSON.stringify(doc,null,2)+'\n';
  writeFileSync(f.path,tampered);
  const result=run(f.path,'matched');
  assert.equal(result.status,3);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/original Bluesky public-copy source invalid/);
  assert.equal(readFileSync(f.path,'utf8'),tampered);
  assert.deepEqual(readdirSync(f.root),['original-copy-record.json']);
});
