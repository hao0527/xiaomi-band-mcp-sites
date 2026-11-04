import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSleepHRV,sleepHRVFromRaw} from '../worker/index.js';
// Entirely synthetic values, deliberately unrelated to the private App comparison.
const fixture={avg_hrv:42,min_hrv:21,max_hrv:69,hrv_median:41,hrv_std:0,hrv_base_min:30,hrv_base_max:60,hrv_lower_quantile:32,hrv_upper_quantile:55,hrv_analysis_timestamp:1704099600};
const verified=['avg_hrv','max_hrv','min_hrv','hrv_base_min','hrv_base_max'];
test('five source mappings have scoped owner-reported ms evidence without claiming an HRV algorithm',()=>{
 const r=extractSleepHRV(fixture);
 assert.deepEqual(r.source_fields,fixture);
 for(const k of verified){
  const m=r.field_metadata[k];
  assert.equal(m.unit,'ms');assert.equal(m.mapping_verified,true);assert.equal(m.unit_verified,true);
  assert.equal(m.algorithm_verified,false);assert.equal(m.kind,'raw');assert.equal(m.confidence,'source_reported');
  assert.equal(m.verification.verified_date,'2026-11-04');
  assert.equal(m.verification.method,'owner_reported_app_reconciliation');
  assert.equal(m.verification.evidence_scope,'single_owner_single_sleep_date');
  assert.equal(m.verification.independently_inspected_app,false);
  // Field mapping evidence does not mean this individual record was reconciled.
  assert.equal(m.verification.record_app_reconciled,null);
 }
 assert.equal(r.unit,null);assert.equal(r.unit_scope,'per_field_metadata_mixed_verification');
 assert.equal(r.algorithm,null);assert.equal(r.algorithm_verified,false);assert.equal(r.validated_hrv_metric,false);
});
test('other source units/semantics remain unverified, including timestamp and standard deviation',()=>{
 const r=extractSleepHRV({...fixture,hrv_future:123});
 for(const k of ['hrv_median','hrv_std','hrv_lower_quantile','hrv_upper_quantile','hrv_analysis_timestamp','hrv_future']){
  assert.equal(r.field_metadata[k].unit,null);assert.equal(r.field_metadata[k].unit_verified,false);
  assert.equal(r.field_metadata[k].mapping_verified,false);
 }
 assert.equal(r.source_fields.hrv_std,0);assert(r.warnings.includes('SOURCE_STD_ZERO_NOT_VALIDATED'));
});
test('mapping verification never converts placeholders into measured HRV zero',()=>{
 const p=Object.fromEntries(Object.keys(fixture).map(k=>[k,0])),r=extractSleepHRV(p);
 assert.deepEqual(r.source_fields,p);assert.equal(r.status,'zero_placeholder_unverified');
 assert.equal(r.has_positive_source_average,false);
 assert(r.warnings.includes('ZERO_PLACEHOLDER_UNVERIFIED'));
 for(const k of verified)assert.equal(r.field_metadata[k].verification.record_app_reconciled,null);
});
test('both raw-envelope formats use the same mapping and do not invent samples',()=>{
 for(const value of [fixture,JSON.stringify(fixture)]){
  const r=sleepHRVFromRaw(JSON.stringify({time:1704099600,value}));
  assert.deepEqual(r.source_fields,fixture);assert.equal(r.field_metadata.avg_hrv.unit,'ms');
  assert.equal(r.samples,undefined);assert.equal(r.algorithm,null);
 }
});
