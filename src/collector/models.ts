export const keys=['steps','calories','sleep','heart_rate','resting_heart_rate','sport','spo2','stress','weight','abnormal_heart_beat','intensity','valid_stand','energy','goal','pai','blood_pressure','blood_sugar','headset','vo2_max','menstruation','steps_daily_aggregate'] as const;
export type MetricKey=typeof keys[number];
export interface RawRecord {time:number;sid?:string;key?:string;zone_offset?:number;zone_name?:string;value:string|Record<string,unknown>;[k:string]:unknown;}
export interface CleanRecord {key:MetricKey;sid:string;time:number;date:string;data:Record<string,unknown>;}
export interface RejectedRecord {raw:unknown;reason:'INVALID_OBJECT'|'INVALID_SECONDS_TIMESTAMP'|'INVALID_SID';index:number;}
export interface Page {records:RawRecord[];hasMore:boolean;nextKey:string|null;rejected?:RejectedRecord[];}
export interface SyncState {rangeStart:string;rangeEnd:string;chunkStart:string;chunkEnd:string;nextKey:string|null;seen:string[];complete:boolean;completedThrough:string|null;version:number;}
export interface Lease {owner:string;token:string;now:number;}
export interface PageCommit {owner:string;key:MetricKey;raw:RawRecord[];clean:CleanRecord[];state:SyncState;lease:Lease;}
export interface Store {acquire(owner:string,now:number):Promise<Lease|null>;release(lease:Lease):Promise<void>;state(owner:string,key:MetricKey):Promise<SyncState|null>;commit(page:PageCommit):Promise<void>;}
