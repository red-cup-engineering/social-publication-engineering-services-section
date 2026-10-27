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
const current='2026-10-27T18:10:00Z';
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
const preload=String.raw