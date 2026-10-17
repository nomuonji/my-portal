'use strict';
const str = (description, maxLength = 12000) => ({ type: 'string', description, maxLength });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const slots = { type: 'array', items: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, minItems: 1, maxItems: 24 };
const TOOLS = [
  {
    name: 'routine_job_list',
    description: 'List Agent HQ lightweight recurring jobs, instructions, schedule slots, and active/paused status. These jobs are independent of Manager/Worker queues.',
    inputSchema: obj({}),
  },
  {
    name: 'routine_job_upsert',
    description: 'Create or revise one lightweight routine job. Scheduling is based on the existing dedicated ChatGPT 04:30/10:30/16:30 JST wake-ups; only matching slots can run. Supply expectedRevision for existing jobs.',
    inputSchema: obj({
      id: str('Stable lowercase job id, e.g. tweets-draft-replenishment',80),
      title: str('Job title',180),
      description: str('Outcome and scope',1000),
      instructions: str('Execution procedure to be read by the scheduled ChatGPT agent',12000),
      targetSystem: str('Canonical specialist Operator',120),
      status: { type: 'string', enum: ['active','paused'] },
      priority: { type: 'string', enum: ['critical','normal','background'], description: 'Within each 3-job shared wake-up, run critical first and once-daily jobs before 3-times-daily jobs.' },
      slots,
      maxAccountsPerRun: { type: 'integer', minimum: 1, maximum: 50 },
      expectedRevision: { type: 'integer', minimum: 1 },
    }, ['id']),
  },
  {
    name: 'routine_job_due',
    description: 'Read jobs due NOW in the configured JST slot window, excluding already claimed slots. The result contains the complete current instructions; call claim before any side effects. No arbitrary timestamps in scheduled use.',
    inputSchema: obj({}),
  },
  {
    name: 'routine_job_claim',
    description: 'Atomically claim a due routine job once per local date and scheduled slot. A duplicate or finished slot cannot be claimed again.',
    inputSchema: obj({
      id: str('Routine job id',80),
      slotKey: str('Exact due.slotKey in YYYY-MM-DD@HH:MM',32),
      agent: str('Executing agent identifier',120),
      runnerId: str('Scheduled Task or runner label',120),
    }, ['id','slotKey','agent']),
  },
  {
    name: 'routine_job_finish',
    description: 'Record real execution result and validation in the durable HQ run ledger. Failed runs must preserve errors. Never claim completed without specialist-system readback.',
    inputSchema: obj({
      runId: str('Exact run id from claim',180),
      agent: str('Exact claiming agent',120),
      status: { type: 'string', enum: ['completed','failed'] },
      resultSummary: str('Actual results or failure reason',3000),
      validation: str('Readback evidence from the target Operator',3000),
      result: { type: 'object', additionalProperties: true },
    }, ['runId','agent','status']),
  },
  {
    name: 'routine_job_runs',
    description: 'Read recent durable run outcomes and errors, optionally filtered by one routine job.',
    inputSchema: obj({
      jobId: str('Optional job id',80),
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }),
  },
];
module.exports = { TOOLS };
