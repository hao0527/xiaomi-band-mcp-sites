// Display policy only: older samples do not prove device/cloud upload failure.
export function freshness(sample:number|null,date:string,today:string,now=Date.now()){
 const age=sample===null?null:Math.max(0,Math.floor(now/1000)-sample),threshold=1800;
 return {latest_sample_at:sample,sample_age_seconds:age,freshness_status:sample===null?'no_cached_sample':date!==today?'historical_date_not_live_freshness_target':age!<=threshold?'within_display_threshold':'older_than_display_threshold',display_threshold_seconds:threshold,cloud_upload_complete:'unknown',warning:'30 minute display policy is not a device sampling guarantee or proof that data was not uploaded'};
}
