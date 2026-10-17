'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {RUNNER_SLOTS,MAX_JOBS_PER_TICK,candidate,validateSlots,validateCapacity,slotLoadsFor,jst}
 =require('../functions/routineJobStore');

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
test('due window is 120 minutes after actual Tokyo clock time',()=>{
 const job={status:'active',slots:['10:30']};
 assert.deepEqual(jst('2026-10-17T01:35:00.000Z'),{day:'2026-10-17',minute:635});
 assert.equal(candidate(job,jst('2026-10-17T01:29:00Z')),null);
 assert.equal(candidate(job,jst('2026-10-17T01:35:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T03:00:00Z')).slotKey,'2026-10-17@10:30');
 assert.equal(candidate(job,jst('2026-10-17T03:30:00Z')),null);
});
test('different JST dates produce distinct idempotent run ids',()=>{
 const job={id:'personal-discovery-curation',status:'active',slots:['04:30']};
 const first=candidate(job,jst('2026-10-16T19:40:00Z'));
 const second=candidate(job,jst('2026-10-17T19:40:00Z'));
 assert.equal(first.slotKey,'2026-10-17@04:30');
 assert.equal(second.slotKey,'2026-10-18@04:30');
 assert.notEqual(first.runId,second.runId);
});