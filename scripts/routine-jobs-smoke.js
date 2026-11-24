'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {RUNNER_SLOTS,MAX_JOBS_PER_TICK,candidate,validateSlots,validateCapacity,slotLoadsFor,jst,validatedInstructions,isStalledRun,STALLED_RUN_MS}
 =require('../functions/routineJobStore');

test('abandoned claims are identified without treating their artifacts as proven failed',()=>{
 const startedAt='2026-11-24T11:30:42.390Z';
 const now=Date.parse(startedAt);
 const running={status:'running',startedAt};
 assert.equal(STALLED_RUN_MS,3*60*60*1000);
 assert.equal(isStalledRun(running,now+STALLED_RUN_MS),false);
 assert.equal(isStalledRun(running,now+STALLED_RUN_MS+1),true);
 assert.equal(isStalledRun({...running,status:'completed'},now+STALLED_RUN_MS+1),false);
 assert.equal(isStalledRun({...running,status:'failed'},now+STALLED_RUN_MS+1),false);
 assert.equal(isStalledRun({...running,startedAt:'invalid'},now+STALLED_RUN_MS+1),false);
 assert.equal(isStalledRun({...running,startedAt:'2026-11-25T11:30:42.390Z'},now+STALLED_RUN_MS+1),false);
});
test('oversized routine instructions fail closed rather than truncating finish/readback rules',()=>{
 assert.equal(validatedInstructions('  finish verified  '),'finish verified');
 assert.equal(validatedInstructions('x'.repeat(12000)).length,12000);
 assert.throws(()=>validatedInstructions('x'.repeat(12001)),/exceed 12000/);
});
test('six real ChatGPT wake-ups, 3 jobs maximum each',()=>{
 assert.deepEqual(RUNNER_SLOTS,['04:30','08:30','10:30','14:30','16:30','20:30']);
 assert.equal(MAX_JOBS_PER_TICK,3);
 assert.deepEqual(validateSlots(['16:30','04:30','16:30']),['04:30','16:30']);
 assert.throws(()=>validateSlots(['04:30','99:30']),/Invalid slot/);
});
test('existing 16:30 capacity full; other slots can still be used',()=>{
 const jobs=[
  {id:'tweets-draft-replenishment',status:'active',slots:['04:30','10:30','16:30']},
  {id:'personal-discovery-curation',status:'active',slots:['04:30','10:30','16:30']},
  {id:'meta-personal-strategy-discovery',status:'active',slots:['16:30']},
 ];
 const summary=slotLoadsFor(jobs);
 assert.deepEqual([summary['04:30'].active,summary['08:30'].active,summary['10:30'].active,summary['14:30'].active,summary['16:30'].active,summary['20:30'].active],[2,0,2,0,3,0]);
 assert.throws(()=>validateCapacity({id:'new-job',status:'active',slots:['16:30']},jobs),/16:30 is full/);
 assert.doesNotThrow(()=>validateCapacity({id:'new-job',status:'active',slots:['08:30','14:30','20:30']},jobs));
 assert.doesNotThrow(()=>validateCapacity({id:'new-job',status:'paused',slots:['16:30']},jobs));
 assert.doesNotThrow(()=>validateCapacity({id:'meta-personal-strategy-discovery',status:'active',slots:['16:30']},jobs));
});
test('no unsupported slot can silently run without scheduled wake-up',()=>{
 assert.throws(()=>validateCapacity({id:'new-job',status:'active',slots:['18:00']},[]),/No ChatGPT runner/);
});
test('early ChatGPT wake-ups use the scheduled slot idempotently, not no-op',()=>{
 const writer={id:'tweets-draft-replenishment',status:'active',slots:['04:30','10:30','14:30','20:30']};
 for (const [earlyTime,onTime,slot] of [
  ['2026-11-22T19:25:00Z','2026-11-22T19:30:00Z','04:30'],
  ['2026-11-23T01:26:00Z','2026-11-23T01:30:00Z','10:30'],
  ['2026-11-23T05:27:00Z','2026-11-23T05:30:00Z','14:30'],
  ['2026-11-23T11:25:00Z','2026-11-23T11:30:00Z','20:30'],
 ]) {
  const early=candidate(writer,jst(earlyTime));
  assert.equal(early.slotKey,'2026-11-23@'+slot);
  assert.deepEqual(early,candidate(writer,jst(onTime)));
 }
 const prep={id:'tweets-editorial-brief-preparation',status:'active',slots:['08:30','16:30']};
 assert.equal(candidate(prep,jst('2026-11-22T23:26:00Z')).slotKey,'2026-11-23@08:30');
 assert.equal(candidate(prep,jst('2026-11-23T07:27:00Z')).slotKey,'2026-11-23@16:30');
 assert.equal(candidate({id:'writer',status:'active',slots:['20:30']},jst('2026-11-23T11:19:00Z')),null);
});
test('due window accepts ten minutes early and closes after 120 minutes',()=>{
 const job={id:'writer',status:'active',slots:['10:30']};
 assert.deepEqual(jst('2026-10-17T01:35:00.000Z'),{day:'2026-10-17',minute:635});
 assert.equal(candidate(job,jst('2026-10-17T01:19:00Z')),null);
 assert.equal(candidate(job,jst('2026-10-17T01:20:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T01:29:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T01:35:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T03:00:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T03:30:00Z')),null);
});
test('early upcoming slot wins over earlier slot within the two-hour after-window',()=>{
 const job={id:'writer',status:'active',slots:['08:30','10:30']};
 assert.equal(candidate(job,jst('2026-11-23T01:25:00Z')).slotKey,'2026-11-23@10:30');
});
test('different JST dates produce distinct idempotent run ids',()=>{
 const job={id:'personal-discovery-curation',status:'active',slots:['04:30']};
 const first=candidate(job,jst('2026-10-16T19:40:00Z'));
 const second=candidate(job,jst('2026-10-17T19:40:00Z'));
 assert.equal(first.slotKey,'2026-10-17@04:30');
 assert.equal(second.slotKey,'2026-10-18@04:30');
 assert.notEqual(first.runId,second.runId);
});