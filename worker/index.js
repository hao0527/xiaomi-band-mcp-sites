var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/collector/http.ts
function allowedURL(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new CollectorError("BLOCKED_URL");
  }
  if (u.protocol !== "https:" || !allowedHosts.has(u.hostname) || u.username || u.password || u.port && u.port !== "443" || u.hash) throw new CollectorError("BLOCKED_URL");
  return u;
}
function nativeFetcher(enabled = false) {
  return async (url, init) => {
    if (!enabled) throw new CollectorError("LIVE_NETWORK_DISABLED");
    allowedURL(url);
    return fetch(url, { ...init, redirect: "manual" });
  };
}
function cookieValue(s) {
  if (!s || /[\s;,\x00-\x1f\x7f]/.test(s)) throw new CollectorError("INVALID_COOKIE");
  return s;
}
async function boundedText(r, max = 2 * 1024 * 1024) {
  const reader = r.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks = [];
  while (true) {
    const { value: value2, done } = await reader.read();
    if (done) break;
    size += value2.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new CollectorError("RESPONSE_TOO_LARGE");
    }
    chunks.push(value2);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CollectorError("INVALID_UTF8");
  }
}
var CollectorError, allowedHosts, token, CookieJar;
var init_http = __esm({
  "src/collector/http.ts"() {
    "use strict";
    CollectorError = class extends Error {
      constructor(code) {
        super(code);
        this.code = code;
        this.name = "CollectorError";
      }
    };
    allowedHosts = /* @__PURE__ */ new Set(["account.xiaomi.com", "sts-hlth.io.mi.com", "hlth.io.mi.com"]);
    token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    CookieJar = class {
      entries = [];
      absorb(url, headers, now = Date.now()) {
        const h = headers;
        const lines = typeof h.getSetCookie === "function" ? h.getSetCookie() : h.getAll?.("Set-Cookie");
        if (!lines) {
          if (headers.has("Set-Cookie")) throw new CollectorError("MULTI_COOKIE_API_UNAVAILABLE");
          return;
        }
        const u = allowedURL(url);
        for (const line of lines) {
          const parts = line.split(";").map((s) => s.trim()), eq = parts[0].indexOf("=");
          if (eq < 1) throw new CollectorError("INVALID_COOKIE");
          const c = { name: parts[0].slice(0, eq), value: parts[0].slice(eq + 1), domain: u.hostname, hostOnly: true, path: u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1) || "/", secure: false, expires: null };
          if (!token.test(c.name) || /[\x00-\x20\x7f;,]/.test(c.value)) throw new CollectorError("INVALID_COOKIE");
          let maxAge = null;
          for (const attr of parts.slice(1)) {
            const i = attr.indexOf("="), k = (i < 0 ? attr : attr.slice(0, i)).toLowerCase(), v = i < 0 ? "" : attr.slice(i + 1);
            if (k === "domain") {
              const dom = v.toLowerCase().replace(/^\./, "");
              if (!["xiaomi.com", "account.xiaomi.com", "mi.com", "io.mi.com", "hlth.io.mi.com", "sts-hlth.io.mi.com"].includes(dom) || !(u.hostname === dom || u.hostname.endsWith("." + dom))) throw new CollectorError("INVALID_COOKIE_DOMAIN");
              c.domain = dom;
              c.hostOnly = false;
            }
            if (k === "path" && v.startsWith("/")) c.path = v;
            if (k === "secure") c.secure = true;
            if (k === "expires") {
              const t = Date.parse(v);
              if (Number.isFinite(t)) c.expires = t;
            }
            if (k === "max-age" && /^-?\d+$/.test(v)) maxAge = Number(v);
          }
          if (maxAge !== null) c.expires = now + maxAge * 1e3;
          this.entries = this.entries.filter((e) => !(e.name === c.name && e.domain === c.domain && e.path === c.path));
          if (c.expires === null || c.expires > now) this.entries.push(c);
        }
      }
      header(url, now = Date.now()) {
        const u = allowedURL(url);
        return this.entries.filter((c) => (c.expires === null || c.expires > now) && (c.hostOnly ? u.hostname === c.domain : u.hostname === c.domain || u.hostname.endsWith("." + c.domain)) && (u.pathname === c.path || u.pathname.startsWith(c.path.endsWith("/") ? c.path : c.path + "/")) && (!c.secure || u.protocol === "https:")).sort((a, b) => b.path.length - a.path.length).map((c) => c.name + "=" + c.value).join("; ");
      }
    };
  }
});

// src/hrv-source.ts
function safeValue(v) {
  if (Array.isArray(v)) return v.map(safeValue);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !/token|cookie|password|ssecurity|authorization|userid|cuserid|deviceid|sid/i.test(k.replace(/[_-]/g, ""))).map(([k, x]) => [k, safeValue(x)]));
  return v;
}
function extractSleepHRV(p) {
  const source_fields = {};
  for (const k of Object.keys(p)) if ((fields.includes(k) || /^hrv_[a-z_]+$/.test(k) || /^[a-z_]+_hrv$/.test(k)) && !/token|cookie|password|security|authorization|user|device|sid/i.test(k)) {
    source_fields[k] = safeValue(p[k]);
  }
  const present = Object.keys(source_fields).length > 0, known = fields.filter((k) => Object.hasOwn(source_fields, k));
  const allZero = known.length === fields.length && known.every((k) => source_fields[k] === 0);
  const positive2 = typeof source_fields.avg_hrv === "number" && Number.isFinite(source_fields.avg_hrv) && source_fields.avg_hrv > 0;
  return {
    source: "xiaomi_cloud.sleep.value",
    kind: "raw",
    unit: null,
    algorithm: null,
    validated_hrv_metric: false,
    source_fields_present: present,
    has_positive_source_average: positive2,
    status: !present ? "missing" : allZero ? "zero_placeholder_unverified" : positive2 ? "source_fields_available" : "source_values_unverified",
    source_fields,
    field_metadata: Object.fromEntries(Object.keys(source_fields).map((k) => [k, { source: "sleep.value." + k, unit: appMappedFields[k] ? "ms" : null, kind: "raw", confidence: appMappedFields[k] ? "source_reported" : "unverified", mapping_verified: !!appMappedFields[k], unit_verified: !!appMappedFields[k], algorithm_verified: false, meaning: appMappedFields[k] ?? (k === "hrv_analysis_timestamp" ? "Source analysis timestamp; event semantics and time unit unverified" : "Source HRV field; unit and algorithm unverified"), ...appMappedFields[k] ? { verification: appMappingEvidence } : {} }])),
    unit_scope: "per_field_metadata_mixed_verification",
    algorithm_verified: false,
    source_complete: p.is_uncomplete === true ? false : p.is_uncomplete === false ? true : null,
    warnings: [...present ? ["UNIT_UNVERIFIED", "ALGORITHM_UNVERIFIED"] : [], ...allZero ? ["ZERO_PLACEHOLDER_UNVERIFIED"] : [], ...Object.hasOwn(source_fields, "hrv_std") && source_fields.hrv_std === 0 ? ["SOURCE_STD_ZERO_NOT_VALIDATED"] : []]
  };
}
function sleepHRVFromRaw(raw) {
  try {
    const r = JSON.parse(raw);
    const p = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
    if (!p || typeof p !== "object" || Array.isArray(p)) throw 0;
    return extractSleepHRV(p);
  } catch {
    return { ...extractSleepHRV({}), status: "raw_decode_failed", warnings: ["RAW_DECODE_FAILED"] };
  }
}
var appMappedFields, appMappingEvidence, fields;
var init_hrv_source = __esm({
  "src/hrv-source.ts"() {
    "use strict";
    appMappedFields = {
      avg_hrv: "\u7761\u7720\u5E73\u5747HRV",
      max_hrv: "\u7761\u7720\u6700\u9AD8HRV",
      min_hrv: "\u7761\u7720\u6700\u4F4EHRV",
      hrv_base_min: "\u4E2A\u4EBA\u57FA\u51C6\u4E0B\u9650",
      hrv_base_max: "\u4E2A\u4EBA\u57FA\u51C6\u4E0A\u9650"
    };
    appMappingEvidence = {
      verified_date: "2026-11-04",
      method: "owner_reported_app_reconciliation",
      evidence_scope: "single_owner_single_sleep_date",
      app: "\u5C0F\u7C73\u8FD0\u52A8\u5065\u5EB7",
      independently_inspected_app: false,
      private_value_evidence: "owner_supplied_comparison_not_embedded_in_public_source",
      applies_to: "sleep_summary_field_mapping_and_unit_only",
      record_app_reconciled: null,
      algorithm_verified: false
    };
    fields = ["avg_hrv", "min_hrv", "max_hrv", "hrv_median", "hrv_std", "hrv_base_min", "hrv_base_max", "hrv_lower_quantile", "hrv_upper_quantile", "hrv_analysis_timestamp"];
  }
});

// src/sleep-normalizer.ts
function normalizeSleep(p, fallbackTime) {
  const start = Number(p.bedtime ?? p.device_bedtime ?? p.bed_timestamp), end = Number(p.wake_up_time ?? p.device_wake_up_time ?? p.out_bed_timestamp ?? fallbackTime);
  if (!finite(start) || !finite(end) || end < start || end - start > 3 * 86400) throw new Error("INVALID_SLEEP_RANGE");
  const expected = { deep: finite(p.sleep_deep_duration) ? p.sleep_deep_duration : null, light: finite(p.sleep_light_duration) ? p.sleep_light_duration : null, rem: finite(p.sleep_rem_duration) ? p.sleep_rem_duration : null, awake: finite(p.sleep_awake_duration) ? p.sleep_awake_duration : finite(p.awake_duration) ? p.awake_duration : null };
  if (p.items !== void 0 && !Array.isArray(p.items)) throw new Error("INVALID_SLEEP_SEGMENTS");
  const segments = (p.items ?? []).map((s) => {
    const a = Number(s.start_time ?? s.start), b = Number(s.end_time ?? s.end), code = Number(s.state);
    if (!finite(a) || !finite(b) || a < start || b > end || b < a || !Number.isInteger(code)) throw new Error("INVALID_SLEEP_SEGMENT");
    return { start_at: a, end_at: b, source_state: code, minutes: (b - a) / 60, stage: "unknown" };
  }).sort((a, b) => a.start_at - b.start_at);
  const overlaps = segments.some((s, i) => i > 0 && s.start_at < segments[i - 1].end_at), coverage = segments.reduce((n, s) => n + s.minutes, 0), elapsed = (end - start) / 60;
  const candidates = segments.length && !overlaps ? maps.filter((c) => {
    const totals = { deep: 0, light: 0, rem: 0, awake: 0 };
    for (const s of segments) {
      const k = c.map[s.source_state];
      if (!k) return false;
      totals[k] += s.minutes;
    }
    return Object.values(expected).filter((x) => x !== null).length >= 3 && Object.entries(expected).every(([k, v]) => v === null || Math.abs(totals[k] - v) < 1 / 60);
  }) : [];
  const mapping = candidates.length === 1 ? candidates[0] : null, issues = [];
  if (segments.length && !mapping) issues.push("STAGE_CODES_NOT_VERIFIED");
  if (overlaps) issues.push("OVERLAPPING_SEGMENTS");
  if (segments.length && Math.abs(coverage - elapsed) > 1 / 60) issues.push("SEGMENT_COVERAGE_MISMATCH");
  if (mapping) for (const s of segments) s.stage = mapping.map[s.source_state];
  const stageSeconds = Object.fromEntries(["deep", "light", "rem", "awake"].map((k) => [k, segments.filter((s) => s.stage === k).reduce((n, s) => n + s.minutes, 0)]));
  const sourceStageTotal = ["deep", "light", "rem"].every((k) => expected[k] !== null) ? Number(expected.deep) + Number(expected.light) + Number(expected.rem) : null;
  const awake = mapping ? stageSeconds.awake : expected.awake;
  const target = sourceStageTotal !== null && sourceStageTotal > 0 ? sourceStageTotal : awake !== null ? elapsed - awake : null;
  const raw = finite(p.duration) ? p.duration : null, unit = raw !== null && target !== null ? Math.abs(raw - target) < 1 / 60 ? "minute" : Math.abs(raw / 60 - target) < 1 / 60 ? "second" : null : null;
  let asleep = unit === "minute" ? raw : unit === "second" ? Number(raw) / 60 : null;
  if (asleep === null && mapping && Math.abs(coverage - elapsed) < 1 / 60) asleep = stageSeconds.deep + stageSeconds.light + stageSeconds.rem;
  if (asleep === null) issues.push("SLEEP_DURATION_UNIT_UNVERIFIED");
  if (asleep !== null && awake !== null && Math.abs(asleep + awake - elapsed) > 1 / 60) issues.push("DURATION_BALANCE_MISMATCH");
  const inBed = finite(p.bed_timestamp) && finite(p.out_bed_timestamp) && p.out_bed_timestamp >= p.bed_timestamp ? (p.out_bed_timestamp - p.bed_timestamp) / 60 : null;
  return { time_boundaries: { session_start_at: start, session_end_at: end, in_bed_start_at: finite(p.bed_timestamp) ? p.bed_timestamp : null, in_bed_end_at: finite(p.out_bed_timestamp) ? p.out_bed_timestamp : null, session_start_source: finite(p.bedtime) ? "bedtime" : finite(p.device_bedtime) ? "device_bedtime" : "bed_timestamp", session_end_source: finite(p.wake_up_time) ? "wake_up_time" : finite(p.device_wake_up_time) ? "device_wake_up_time" : finite(p.out_bed_timestamp) ? "out_bed_timestamp" : "fallback", in_bed_method: finite(p.bed_timestamp) && finite(p.out_bed_timestamp) && p.out_bed_timestamp >= p.bed_timestamp ? "source_bed_boundaries" : "fallback_session_interval", unit: "unix_second", warning: "in_bed includes source bed boundaries; session is the selected sleep interval; arithmetic validity does not establish source completeness" }, start_at: start, end_at: end, duration_minutes: asleep, time_asleep_minutes: asleep, time_awake_minutes: awake, in_bed_minutes: inBed, session_minutes: elapsed, sleep_score: finite(p.score) ? p.score : finite(p.sleep_score) ? p.sleep_score : null, is_nap: typeof p.is_nap === "boolean" ? p.is_nap : null, stages: segments, stage_minutes: { deep: mapping ? stageSeconds.deep : null, light: mapping ? stageSeconds.light : null, rem: mapping ? stageSeconds.rem : null, awake: mapping ? stageSeconds.awake : null }, source_stage_minutes: expected, source_duration: raw, source_duration_unit: unit, stage_mapping: mapping?.name ?? "unverified", source_complete: p.is_uncomplete === false ? true : p.is_uncomplete === true ? false : null, quality: { status: issues.length ? "partial" : "validated", issues, stage_mapping_evidence: mapping ? "segments_match_named_source_totals" : "unverified", time_unit_evidence: unit ? "duration_matches_timestamps_and_stage_totals" : "unverified" }, hrv: extractSleepHRV(p), parser_version: "quality-v2" };
}
var finite, maps;
var init_sleep_normalizer = __esm({
  "src/sleep-normalizer.ts"() {
    "use strict";
    init_hrv_source();
    finite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    maps = [{ name: "cloud_2deep_3light_4rem_5awake", map: { 2: "deep", 3: "light", 4: "rem", 5: "awake" } }, { name: "sdk_1light_2deep_3rem_4awake", map: { 1: "light", 2: "deep", 3: "rem", 4: "awake" } }, { name: "alternate_2light_3deep_4rem_5awake", map: { 2: "light", 3: "deep", 4: "rem", 5: "awake" } }];
  }
});

// src/collector/parser.ts
function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CollectorError("INVALID_OBJECT");
  return v;
}
function num(v, fallback) {
  if (v === null || v === void 0) {
    if (fallback !== void 0) return fallback;
    throw new CollectorError("MISSING_NUMBER");
  }
  if (typeof v !== "number" && typeof v !== "string" || v === "" || !Number.isFinite(Number(v))) throw new CollectorError("INVALID_NUMBER");
  return Number(v);
}
function positive(v, fallback = 0) {
  const n = num(v, fallback);
  if (n < 0) throw new CollectorError("NEGATIVE_VALUE");
  return n;
}
function validateRaw(v) {
  const r = object(v);
  if (!Number.isSafeInteger(r.time) || Number(r.time) < 0 || Number(r.time) > 4102444800) throw new CollectorError("INVALID_SECONDS_TIMESTAMP");
  if (r.sid !== void 0 && typeof r.sid !== "string") throw new CollectorError("INVALID_SID");
  if (r.key !== void 0 && typeof r.key !== "string") throw new CollectorError("INVALID_KEY");
  if (r.zone_offset !== void 0 && (!Number.isInteger(r.zone_offset) || Math.abs(Number(r.zone_offset)) > 86400)) throw new CollectorError("INVALID_OFFSET");
  value(r);
  return r;
}
function value(r) {
  try {
    const v = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
    return typeof v === "number" && Number.isFinite(v) ? { value: v } : object(v);
  } catch {
    throw new CollectorError("INVALID_RECORD_VALUE");
  }
}
function dateCN(seconds) {
  return new Date(seconds * 1e3).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
function dateRange(start, end) {
  const parse = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || (/* @__PURE__ */ new Date(s + "T00:00:00Z")).toISOString().slice(0, 10) !== s) throw new CollectorError("INVALID_DATE");
    return Date.parse(s + "T00:00:00+08:00") / 1e3;
  };
  const a = parse(start), b = parse(end) + 86399;
  if (a > b || b - a > 366 * 86400) throw new CollectorError("INVALID_RANGE");
  return { start: a, end: b };
}
function parseRecord(key, input) {
  const r = validateRaw(input), p = value(r);
  const base = { key, sid: r.sid ?? "", time: r.time, date: dateCN(r.time), data: {} };
  const optional = (v) => {
    if (v === void 0 || v === null) return null;
    const n = positive(v);
    return n === 0 ? null : n;
  };
  if (key === "steps") base.data = { steps: Math.trunc(positive(p.steps)), distance_m: p.distance == null ? null : positive(p.distance), active_kcal: p.calories == null ? null : positive(p.calories) };
  else if (key === "calories") base.data = { active_kcal: positive(p.calories) };
  else if (key === "heart_rate" || key === "resting_heart_rate") {
    const timestamp = key === "resting_heart_rate" ? num(p.date_time || r.time) : r.time;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 4102444800) throw new CollectorError("INVALID_SECONDS_TIMESTAMP");
    base.date = dateCN(timestamp);
    base.data = { timestamp, bpm: Math.trunc(positive(p.bpm)), sample_type: key === "resting_heart_rate" ? "resting" : num(p.type, 0) === 0 ? "passive" : "active" };
  } else if (key === "sleep") {
    const normalized = normalizeSleep(p, r.time);
    base.date = dateCN(normalized.end_at);
    base.data = normalized;
  } else if (key === "sport") {
    const start = num(p.start_time || r.time), duration = Math.trunc(positive(p.duration || 0)), end = num(p.end_time || start + duration);
    if (end < start || end - start > 86400 * 30) throw new CollectorError("INVALID_WORKOUT_RANGE");
    base.date = dateCN(start);
    base.data = { start_at: start, end_at: end, duration_minutes: Math.floor(duration / 60) || Math.floor((end - start) / 60), activity_type: String(r.category || r.key || p.sport_type || "workout"), distance_m: optional(p.distance), calories_kcal: p.calories == null ? null : positive(p.calories), total_calories_kcal: p.total_cal == null ? null : positive(p.total_cal), duration_seconds: duration, recovery_time_raw: p.recover_time ?? null, avg_heart_rate_bpm: optional(p.avg_hrm), max_heart_rate_bpm: optional(p.max_hrm), avg_pace_sec_per_km: optional(p.avg_pace), max_pace_sec_per_km: optional(p.max_pace), total_steps: optional(p.steps || p.total_steps) };
  } else if (key === "steps_daily_aggregate") {
    const steps = num(p.steps ?? p.value);
    if (!Number.isSafeInteger(steps) || steps < 0) throw new CollectorError("INVALID_STEPS");
    base.data = { value: steps, daily_steps: steps, distance_m: p.distance ?? null, source_report_calories_kcal: p.calories ?? null, source_tag: "daily_report", source_key: "steps", unit_status: "step_count", parser_version: "quality-v2" };
  } else if (key === "spo2") {
    const n = num(p.spo2 ?? p.value);
    if (n <= 0 || n > 100) throw new CollectorError("INVALID_SPO2");
    base.data = { spo2_pct: n };
  } else if (key === "stress") {
    const n = num(p.stress ?? p.score ?? p.value ?? p.stress_value);
    if (n < 0 || n > 100) throw new CollectorError("INVALID_STRESS");
    base.data = { stress_score: n };
  } else if (key === "abnormal_heart_beat") {
    const start = num(p.start_time ?? r.time), end = num(p.end_time ?? start);
    if (end < start) throw new CollectorError("INVALID_EVENT_RANGE");
    base.data = { start_at: start, end_at: end, duration_seconds: end - start, event_type: "source_reported_abnormal_heart_beat", interpretation: "not_a_diagnosis" };
  } else {
    const fields2 = {};
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number" && Number.isFinite(v) && !/(?:id$|sid|mac|imei|imsi|phone|lat|lon|location|address|token|cookie|password|security)/i.test(k)) fields2[k] = v;
    }
    if (!Object.keys(fields2).length) throw new CollectorError("SCHEMA_UNVERIFIED");
    base.data = { source_fields: fields2, unit_status: "unverified" };
    const choices = { steps_daily_aggregate: ["steps", "value"], weight: ["weight"], intensity: ["intensity", "value", "duration"], valid_stand: ["valid_stand", "stand", "value"], energy: ["energy", "value"], goal: ["goal", "value", "steps"], pai: ["daily_pai", "pai", "value"], blood_pressure: ["systolic", "high_pressure", "value"], blood_sugar: ["blood_sugar", "value"], headset: ["value"], vo2_max: ["vo2_max", "value"], menstruation: ["value"] };
    const field = (choices[key] ?? []).find((k) => typeof fields2[k] === "number");
    if (field) {
      base.data.value = fields2[field];
      base.data.value_field = field;
    }
  }
  return base;
}
var addDays;
var init_parser = __esm({
  "src/collector/parser.ts"() {
    "use strict";
    init_sleep_normalizer();
    init_http();
    addDays = (date, n) => dateCN(Date.parse(date + "T00:00:00+08:00") / 1e3 + n * 86400);
  }
});

// src/step-audit.ts
var step_audit_exports = {};
__export(step_audit_exports, {
  applyStepPolicy: () => applyStepPolicy,
  saveStepReferences: () => saveStepReferences,
  stepsAudit: () => stepsAudit,
  verifySteps: () => verifySteps
});
async function stepsAudit(env, start, end) {
  const range = dateRange(start, end);
  if (range.end - range.start >= 31 * 86400) throw new CollectorError("QUERY_RANGE_TOO_LONG");
  const d = env.DB;
  const refs = (await d.prepare("SELECT date_cn,app_steps FROM step_references WHERE date_cn>=? AND date_cn<=? ORDER BY date_cn").bind(start, end).all()).results;
  const sourceRows = (await d.prepare("SELECT date_cn,source_hash,COUNT(*) AS records,SUM(json_extract(clean_json,'$.steps')) AS steps_sum FROM raw_records WHERE metric='steps' AND clean_json IS NOT NULL AND date_cn>=? AND date_cn<=? GROUP BY date_cn,source_hash").bind(start, end).all()).results;
  const minute = (await d.prepare("SELECT date_cn,SUM(v) AS total FROM (SELECT date_cn,CAST(recorded_at/60 AS INTEGER) AS minute,MAX(json_extract(clean_json,'$.steps')) AS v FROM raw_records WHERE metric='steps' AND clean_json IS NOT NULL AND date_cn>=? AND date_cn<=? GROUP BY date_cn,minute) GROUP BY date_cn").bind(start, end).all()).results;
  const agg = (await d.prepare("SELECT date_cn,CASE WHEN COUNT(DISTINCT json_extract(clean_json,'$.value'))=1 THEN MAX(json_extract(clean_json,'$.value')) ELSE NULL END AS total FROM raw_records WHERE metric='steps_daily_aggregate' AND clean_json IS NOT NULL AND date_cn>=? AND date_cn<=? GROUP BY date_cn").bind(start, end).all()).results;
  const hashes = [...new Set(sourceRows.map((x) => x.source_hash))].sort(), sources = hashes.map((h, i) => ({ label: "\u6765\u6E90" + (i + 1), days: sourceRows.filter((x) => x.source_hash === h).map(({ date_cn, records, steps_sum }) => ({ date: date_cn, records, steps_sum })) }));
  const checks = refs.map((r) => ({ date: r.date_cn, app_steps: r.app_steps, raw_all_sources_sum: sourceRows.filter((x) => x.date_cn === r.date_cn).reduce((a, x) => a + x.steps_sum, 0), minute_max_sum: minute.find((x) => x.date_cn === r.date_cn)?.total ?? null, cloud_daily_aggregate: agg.find((x) => x.date_cn === r.date_cn)?.total ?? null, by_source: sources.map((x) => ({ source: x.label, steps: x.days.find((y) => y.date === r.date_cn)?.steps_sum ?? null })) }));
  const match = (f) => refs.length >= 3 && refs.every((r) => f(r) === r.app_steps);
  let candidate = null;
  if (match((r) => agg.find((x) => x.date_cn === r.date_cn)?.total)) candidate = { strategy: "cloud_daily_aggregate" };
  else {
    const matched = hashes.filter((h) => match((r) => sourceRows.find((x) => x.source_hash === h && x.date_cn === r.date_cn)?.steps_sum));
    if (matched.length === 1) candidate = { strategy: "verified_primary_source", source_hash: matched[0] };
    else if (match((r) => minute.find((x) => x.date_cn === r.date_cn)?.total)) candidate = { strategy: "verified_minute_max" };
  }
  const stored = await d.prepare("SELECT policy_json,verified_at FROM aggregation_policies WHERE metric='steps'").first();
  return { result: { start_date: start, end_date: end, references: refs.length, checks, sources, candidate: candidate ? { strategy: candidate.strategy, matched_all_references: true } : null, active_policy: stored ? { strategy: JSON.parse(stored.policy_json).strategy, verified_at: stored.verified_at } : null, timezone: "Asia/Shanghai", note: "\u53EA\u6BD4\u8F83\u6765\u6E90\u4E0E\u53E3\u5F84\uFF1B\u539F\u59CB\u6570\u636E\u4E0D\u5220\u9664\u3001\u4E0D\u6309\u53C2\u8003\u503C\u6539\u5199\u3002" }, candidate, refs };
}
async function saveStepReferences(env, items) {
  if (!Array.isArray(items) || !items.length || items.length > 31) throw new CollectorError("INVALID_REFERENCES");
  const d = env.DB;
  for (const it of items) {
    if (!it || typeof it !== "object" || typeof it.date !== "string" || !Number.isSafeInteger(it.steps) || it.steps < 0 || it.steps > 1e6) throw new CollectorError("INVALID_REFERENCE");
    dateRange(it.date, it.date);
  }
  await d.prepare("DELETE FROM aggregation_policies WHERE metric='steps'").run();
  await d.prepare("UPDATE daily_summary SET steps=NULL,step_semantics='unverified'").run();
  await d.batch(items.map((it) => d.prepare("INSERT INTO step_references(date_cn,app_steps,saved_at) VALUES(?,?,?) ON CONFLICT(date_cn) DO UPDATE SET app_steps=excluded.app_steps,saved_at=excluded.saved_at").bind(it.date, it.steps, Date.now())));
  return { saved: items.length };
}
async function verifySteps(env, start, end) {
  const audit = await stepsAudit(env, start, end);
  if (!audit.candidate) {
    await env.DB.prepare("DELETE FROM aggregation_policies WHERE metric='steps'").run();
    await env.DB.prepare("UPDATE daily_summary SET steps=NULL,step_semantics='unverified'").run();
  }
  if (audit.candidate) {
    await env.DB.prepare("INSERT INTO aggregation_policies(metric,policy_json,verified_at) VALUES('steps',?,?) ON CONFLICT(metric) DO UPDATE SET policy_json=excluded.policy_json,verified_at=excluded.verified_at").bind(JSON.stringify({ ...audit.candidate, verified_dates: audit.refs.map((x) => x.date_cn), evidence: "user_app_references" }), Date.now()).run();
    const dates2 = (await env.DB.prepare("SELECT date_cn FROM daily_summary").all()).results;
    for (const r of dates2) await applyStepPolicy(env.DB, r.date_cn);
  }
  return { ...audit.result, policy_applied: !!audit.candidate };
}
async function applyStepPolicy(d, date) {
  const row = await d.prepare("SELECT policy_json FROM aggregation_policies WHERE metric='steps'").first();
  if (!row) return;
  const p = JSON.parse(row.policy_json);
  let result = null;
  if (p.strategy === "cloud_daily_aggregate") result = await d.prepare("SELECT COUNT(*) AS n,CASE WHEN COUNT(DISTINCT json_extract(clean_json,'$.value'))=1 THEN MAX(json_extract(clean_json,'$.value')) ELSE NULL END AS total FROM raw_records WHERE metric='steps_daily_aggregate' AND date_cn=? AND clean_json IS NOT NULL").bind(date).first();
  if (p.strategy === "verified_primary_source") result = await d.prepare("SELECT COUNT(*) AS n,SUM(json_extract(clean_json,'$.steps')) AS total FROM raw_records WHERE metric='steps' AND date_cn=? AND source_hash=? AND clean_json IS NOT NULL").bind(date, p.source_hash).first();
  if (p.strategy === "verified_minute_max") result = await d.prepare("SELECT COUNT(*) AS n,SUM(v) AS total FROM (SELECT CAST(recorded_at/60 AS INTEGER) AS minute,MAX(json_extract(clean_json,'$.steps')) AS v FROM raw_records WHERE metric='steps' AND date_cn=? AND clean_json IS NOT NULL GROUP BY minute)").bind(date).first();
  await d.prepare("UPDATE daily_summary SET steps=?,step_semantics=? WHERE date_cn=?").bind(result && result.n > 0 ? result.total : null, result && result.n > 0 ? p.strategy : "verified_source_missing", date).run();
}
var init_step_audit = __esm({
  "src/step-audit.ts"() {
    "use strict";
    init_parser();
    init_http();
  }
});

// src/raw-record-reader.ts
init_http();
var normalizedKey = (k) => k.replace(/[_\s-]/g, "").toLowerCase();
var credentialKey = /token|cookie|password|security|authorization|secret|credential|sessionkey|objkey|signature|privatekey|accesskey|apikey|aeskey|rc4key|^auth$|^session$/i;
var identifierKeys = /* @__PURE__ */ new Set(["id", "sid", "did", "userid", "cuserid", "accountid", "deviceid", "sourceid", "sourcesidlist", "mac", "macaddress", "imei", "imsi", "phone", "phonenumber", "email", "name", "username", "nickname", "serialnumber", "sn"]);
var locationKeys = /* @__PURE__ */ new Set(["lat", "latitude", "lon", "lng", "longitude", "gps", "route", "track", "coordinates", "coordinate", "location", "address"]);
function sourceResponseEmpty(v) {
  if (v === null || v === void 0 || v === "") return true;
  if (Array.isArray(v)) return v.every(sourceResponseEmpty);
  if (v && typeof v === "object") return Object.values(v).every(sourceResponseEmpty);
  return false;
}
function redactRawRecord(input) {
  const redactions = { credential_fields: 0, identifier_fields: 0, location_fields: 0, url_values: 0, sensitive_strings: 0 };
  let nodes = 0;
  function clean(v, depth) {
    if (++nodes > 2e5 || depth > 40) throw new CollectorError("RAW_REDACTION_LIMIT");
    if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
    if (v && typeof v === "object") {
      const out = /* @__PURE__ */ Object.create(null);
      for (const [k, x] of Object.entries(v)) {
        const n = normalizedKey(k);
        if (credentialKey.test(n)) {
          redactions.credential_fields++;
          continue;
        }
        if (identifierKeys.has(n) || /userid|cuserid|deviceid|accountid|sourceid|sourcesidlist/.test(n)) {
          redactions.identifier_fields++;
          continue;
        }
        if (locationKeys.has(n) || /latitude|longitude|^(?:start|end)(?:lat|lon|lng)$/.test(n)) {
          redactions.location_fields++;
          continue;
        }
        out[k] = clean(x, depth + 1);
      }
      return out;
    }
    if (typeof v === "string") {
      if (/^[\[{]/.test(v.trim())) {
        try {
          const decoded = JSON.parse(v);
          const before = JSON.stringify(redactions), next = clean(decoded, depth + 1);
          return JSON.stringify(redactions) === before ? v : JSON.stringify(next);
        } catch (e) {
          if (e instanceof CollectorError) throw e;
        }
      }
      if (/https?:\/\//i.test(v)) {
        redactions.url_values++;
        return "[REDACTED_URL_VALUE]";
      }
      if (/(?:pass[_-]?token|service[_-]?token|ssecurity|authorization|cookie|password|secret|credential)\s*[:=]|\bBearer\s+\S+/i.test(v)) {
        redactions.sensitive_strings++;
        return "[REDACTED_SENSITIVE_STRING]";
      }
    }
    return v;
  }
  return { value: clean(input, 0), redactions };
}
async function rawRecord(env, recordRef, offset = 0, limit = 8192, snapshotHash, component = "metric_record") {
  if (!["metric_record", "activity_operational", "ingestion_quarantine"].includes(component)) throw new CollectorError("INVALID_COMPONENT");
  if (typeof recordRef !== "string" || !/^[A-Za-z0-9+/_=-]{8,100}$/.test(recordRef)) throw new CollectorError("INVALID_RECORD_REF");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new CollectorError("INVALID_OFFSET");
  if (!Number.isInteger(limit) || limit < 256 || limit > 16384) throw new CollectorError("INVALID_LIMIT");
  if (snapshotHash !== void 0 && (typeof snapshotHash !== "string" || !/^[a-f0-9]{64}$/.test(snapshotHash))) throw new CollectorError("INVALID_SNAPSHOT");
  if (offset > 0 && !snapshotHash) throw new CollectorError("RAW_SNAPSHOT_REQUIRED");
  if (!env.DB) throw new CollectorError("DATABASE_NOT_READY");
  let row, preservation = null, quarantineContext = null;
  if (component === "ingestion_quarantine") {
    const q = await env.DB.prepare("SELECT quarantine_id,metric,requested_start,requested_end,reason_code,raw_json,redactions_json,last_seen_at FROM ingestion_quarantine WHERE quarantine_id=?").bind(recordRef).first();
    if (!q) return { status: "not_found", record_ref: recordRef, component, network_requests_performed: false };
    row = { record_id: q.quarantine_id, metric: q.metric, recorded_at: null, date_cn: null, source_hash: null, raw_json: q.raw_json, parse_status: "quarantined", synced_at: q.last_seen_at };
    quarantineContext = { requested_start: q.requested_start, requested_end: q.requested_end, reason_code: q.reason_code, source_time_not_invented: true };
  } else {
    const r = await env.DB.prepare("SELECT record_id,metric,recorded_at,date_cn,source_hash,raw_json,parse_status,synced_at FROM raw_records WHERE record_id=?").bind(recordRef).first();
    if (!r) return { status: "not_found", record_ref: recordRef, component, network_requests_performed: false };
    row = r;
    if (component === "activity_operational") {
      if (r.metric !== "sport") return { status: "component_not_applicable", record_ref: recordRef, component, network_requests_performed: false };
      const op = await env.DB.prepare("SELECT status,raw_json,raw_meta_json,fetched_at FROM activity_details WHERE record_ref=?").bind(recordRef).first();
      if (!op?.raw_json) return { status: op?.status === "fetched" ? "legacy_projected_cache_no_raw_response" : "raw_not_fetched", record_ref: recordRef, component, raw_response_available: false, network_requests_performed: false };
      let meta2 = {};
      try {
        meta2 = JSON.parse(op.raw_meta_json ?? "{}");
      } catch {
      }
      preservation = redactRawRecord(meta2).value;
      row = { ...r, raw_json: op.raw_json, parse_status: "operational_" + op.status, synced_at: typeof meta2.raw_fetched_at === "number" ? meta2.raw_fetched_at : op.fetched_at };
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(row.raw_json);
  } catch {
    return { status: "raw_envelope_invalid_json", record_ref: recordRef, metric: row.metric, raw_preserved_in_d1: true, raw_content_withheld_reason: "UNPARSED_CONTENT_SECRET_SAFETY", network_requests_performed: false };
  }
  const clean = redactRawRecord(parsed), json = JSON.stringify(clean.value), digest2 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(component === "metric_record" ? json : component + "\0" + json)), hash2 = Array.from(new Uint8Array(digest2), (x) => x.toString(16).padStart(2, "0")).join("");
  if (component === "activity_operational") preservation = { ...preservation, source_response_empty: sourceResponseEmpty(clean.value), source_response_empty_rule: "no_nonempty_leaf_v1" };
  if (snapshotHash && snapshotHash !== hash2) throw new CollectorError("RECORD_CHANGED_RESTART");
  if (offset > json.length || offset > 0 && /[\uD800-\uDBFF]/.test(json[offset - 1]) && /[\uDC00-\uDFFF]/.test(json[offset] ?? "")) throw new CollectorError("INVALID_OFFSET");
  let end = Math.min(offset + limit, json.length);
  if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1]) && /[\uDC00-\uDFFF]/.test(json[end])) end--;
  return { status: "available", component, preservation, quarantine_context: quarantineContext, record_ref: row.record_id, metric: row.metric, recorded_at: row.recorded_at, stored_date_cn: row.date_cn, source_ref: row.source_hash, parse_status: row.parse_status, last_ingested_at: row.synced_at, snapshot_hash: hash2, offset, limit, next_offset: end < json.length ? end : null, total_characters: json.length, offset_unit: "utf16_code_unit", timestamp_units: { recorded_at: "unix_second", last_ingested_at: "unix_millisecond" }, complete_meaning: "end_of_record_reached_concat_all_chunks_from_offset_0", raw_json_chunk: json.slice(offset, end), complete: end === json.length, redactions: clean.redactions, raw_preserved_in_d1: true, source_fields_unmodified_except_explicit_redactions: true, unit_policy: "unknown_source_units_are_not_inferred", network_requests_performed: false, timezone: "Asia/Shanghai" };
}
var rawReadErrors = /* @__PURE__ */ new Set(["INVALID_COMPONENT", "INVALID_RECORD_REF", "INVALID_OFFSET", "INVALID_LIMIT", "INVALID_SNAPSHOT", "RAW_SNAPSHOT_REQUIRED", "RECORD_CHANGED_RESTART", "RAW_REDACTION_LIMIT"]);

// src/collector/crypto.ts
var utf8 = (s) => new TextEncoder().encode(s);
var text = (b) => new TextDecoder("utf-8", { fatal: true }).decode(b);
function b64(b) {
  let s = "";
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s);
}
function unb64(s) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error("INVALID_BASE64");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
async function digest(algorithm, data) {
  return new Uint8Array(await crypto.subtle.digest(algorithm, new Uint8Array(data)));
}
function nonce(nowMs = Date.now(), random8 = crypto.getRandomValues(new Uint8Array(8))) {
  const minutes = Math.floor(nowMs / 6e4);
  if (random8.length !== 8 || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 4294967295) throw new Error("INVALID_NONCE_INPUT");
  const out = new Uint8Array(12);
  out.set(random8);
  new DataView(out.buffer).setUint32(8, minutes, false);
  return out;
}
async function signedNonce(security, n) {
  const v = new Uint8Array(security.length + n.length);
  v.set(security);
  v.set(n, security.length);
  return digest("SHA-256", v);
}
var RC4 = class {
  s = Uint8Array.from({ length: 256 }, (_, i) => i);
  i = 0;
  j = 0;
  constructor(key, drop = 1024) {
    if (!key.length || key.length > 256 || !Number.isInteger(drop) || drop < 0) throw new Error("INVALID_RC4_INPUT");
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = j + this.s[i] + key[i % key.length] & 255;
      [this.s[i], this.s[j]] = [this.s[j], this.s[i]];
    }
    for (let n = 0; n < drop; n++) this.next();
  }
  next() {
    this.i = this.i + 1 & 255;
    this.j = this.j + this.s[this.i] & 255;
    [this.s[this.i], this.s[this.j]] = [this.s[this.j], this.s[this.i]];
    return this.s[this.s[this.i] + this.s[this.j] & 255];
  }
  crypt(data) {
    return Uint8Array.from(data, (v) => v ^ this.next());
  }
};
var rc4 = (key, data) => new RC4(key).crypt(data);
async function signature(method, path, values, key) {
  let s = method + "&" + path + "&data=" + values.data;
  if ("rc4_hash__" in values) s += "&rc4_hash__=" + values.rc4_hash__;
  return b64(await digest("SHA-1", utf8(s + "&" + b64(key))));
}
function pythonJSON(value2) {
  const s = JSON.stringify(value2);
  if (s === void 0) throw new Error("INVALID_JSON");
  return s.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
async function encryptRequest(payload, path, security, n = nonce()) {
  const key = await signedNonce(security, n), plain = { data: pythonJSON(payload), rc4_hash__: "" };
  plain.rc4_hash__ = await signature("POST", path, { data: plain.data }, key);
  const form = { data: b64(rc4(key, utf8(plain.data))), rc4_hash__: b64(rc4(key, utf8(plain.rc4_hash__))), signature: "", _nonce: b64(n) };
  form.signature = await signature("POST", path, form, key);
  return { form, key };
}
async function auxiliaryEncrypted(method, path, params, security, n) {
  const key = await signedNonce(security, n), sk = b64(key), p = path.startsWith("https://") ? new URL(path).pathname : path;
  const plain = Object.fromEntries(Object.entries(params).filter(([k, v]) => k && v !== ""));
  const sha2 = async (v) => b64(await digest("SHA-1", utf8(v.join("&"))));
  plain.rc4_hash__ = await sha2([method.toUpperCase(), p, ...Object.keys(plain).sort().map((k) => k + "=" + plain[k]), sk]);
  const stream = new RC4(key), enc = {};
  for (const k of Object.keys(plain).sort()) enc[k] = b64(stream.crypt(utf8(plain[k])));
  return { ...enc, signature: await sha2([method.toUpperCase(), p, ...Object.keys(enc).map((k) => k + "=" + enc[k]), sk]), _nonce: b64(n) };
}

// src/collector/adapter.ts
init_http();

// src/collector/auth.ts
init_http();
var ACCOUNT_USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 12; V2284A Build/ab8c0d1.1) APP/mi.health APPV/353001 MK/VjIyODRB SDKV/5.3.0.release.68 CPN/com.mi.health PassportSDK/";
var ACCOUNT_SDK_VERSION = "3.9";
var LoginDiagnosticError = class extends CollectorError {
  constructor(code, diagnostics) {
    super(code);
    this.diagnostics = diagnostics;
  }
};
function loginDiagnostics(p, httpStatus, stage) {
  return {
    stage,
    httpStatus,
    accountCode: typeof p.code === "number" && Number.isSafeInteger(p.code) && Math.abs(p.code) <= 1e6 ? p.code : null,
    accountCodeType: p.code === void 0 ? "missing" : typeof p.code === "number" ? "number" : typeof p.code === "string" ? "string" : "other",
    hasSecurity: typeof p.ssecurity === "string" && p.ssecurity.length > 0,
    hasLocation: typeof p.location === "string" && p.location.length > 0,
    hasReturnedPassToken: typeof p.passToken === "string" && p.passToken.length > 0,
    hasCaptcha: !!p.captchaUrl,
    hasNotification: !!p.notificationUrl
  };
}
function loginPayload(raw) {
  if (!raw.startsWith("&&&START&&&")) throw new CollectorError("INVALID_LOGIN_PREFIX");
  try {
    const o = JSON.parse(raw.slice(11));
    if (!o || typeof o !== "object" || Array.isArray(o)) throw 0;
    return o;
  } catch {
    throw new CollectorError("INVALID_LOGIN_JSON");
  }
}
async function loginWithToken(fetcher, userId, passToken) {
  const url = "https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=miothealth";
  const jar = new CookieJar();
  const r = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(2e4), headers: { "User-Agent": ACCOUNT_USER_AGENT, Cookie: `sdkVersion=${ACCOUNT_SDK_VERSION}; userId=${cookieValue(userId)}; passToken=${cookieValue(passToken)}` } });
  if (!r.ok) throw new LoginDiagnosticError("LOGIN_HTTP_ERROR", loginDiagnostics({}, r.status, "service_login"));
  jar.absorb(url, r.headers);
  let p;
  try {
    p = loginPayload(await boundedText(r));
  } catch (e) {
    throw new LoginDiagnosticError(e instanceof CollectorError ? e.code : "INVALID_LOGIN_RESPONSE", loginDiagnostics({}, r.status, "service_login"));
  }
  const reject = (code) => new LoginDiagnosticError(code, loginDiagnostics(p, r.status, "service_login"));
  if (p.captchaUrl || p.notificationUrl) throw reject("INTERACTIVE_AUTH_REQUIRED");
  if (p.code !== void 0 && p.code !== 0) throw reject("LOGIN_REJECTED");
  if (typeof p.ssecurity !== "string" || typeof p.location !== "string" || typeof p.passToken !== "string" || typeof p.userId !== "string" && typeof p.userId !== "number") throw reject("LOGIN_FIELDS_MISSING");
  const security = unb64(p.ssecurity);
  if (!security.length) throw reject("LOGIN_SECURITY_EMPTY");
  let target = allowedURL(p.location);
  if (target.hostname !== "sts-hlth.io.mi.com") throw new CollectorError("BLOCKED_STS_HOST");
  for (let hop = 0; hop < 5; hop++) {
    const sts = await fetcher(target.href, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(2e4), headers: { "User-Agent": ACCOUNT_USER_AGENT, Cookie: jar.header(target.href) } });
    if (!sts.ok && ![301, 302, 303, 307, 308].includes(sts.status)) throw new LoginDiagnosticError("STS_HTTP_ERROR", loginDiagnostics(p, sts.status, "sts"));
    jar.absorb(target.href, sts.headers);
    const healthCookies = jar.header(target.href);
    if (healthCookies.split("; ").some((v) => v.startsWith("serviceToken="))) {
      const selected = healthCookies.split("; ").filter((v) => /^(serviceToken|cUserId|locale)=/.test(v));
      if (typeof p.cUserId === "string" && !selected.some((v) => v.startsWith("cUserId="))) selected.push("cUserId=" + cookieValue(p.cUserId));
      return { security, cookies: selected.join("; "), userId: String(p.userId), passToken: cookieValue(p.passToken) };
    }
    const location = sts.headers.get("Location");
    if (sts.status >= 300 && sts.status < 400 && location) {
      const next = allowedURL(new URL(location, target).href);
      if (next.hostname !== "sts-hlth.io.mi.com") throw new CollectorError("BLOCKED_REDIRECT");
      target = next;
      continue;
    }
    throw new LoginDiagnosticError("SERVICE_TOKEN_MISSING", loginDiagnostics(p, sts.status, "sts"));
  }
  throw new CollectorError("REDIRECT_LIMIT");
}

// src/collector/adapter.ts
init_parser();
var FITNESS_PATH = "/app/v1/data/get_fitness_data_by_time";
var SPORT_PATH = "/app/v1/data/get_sport_records_by_time";
var AGGREGATE_PATH = "/app/v1/data/get_aggregated_fitness_data_by_time";
var SPORT_OPERATIONAL_PATH = "/app/v1/operate/get_sport_operational_data";
var NATIVE_FILE_PATH = "/healthapp/service/gen_download_url";
var MiFitnessAdapter = class {
  constructor(transport = nativeFetcher(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), makeNonce, retryPolicy = {}) {
    this.transport = transport;
    this.sleep = sleep;
    this.makeNonce = makeNonce;
    this.retryPolicy = retryPolicy;
  }
  session = null;
  async login(userId, passToken) {
    this.session = null;
    this.session = await loginWithToken(this.transport, userId, passToken);
  }
  // Session injection is backend-only and intended for deterministic tests / secret-store hydration.
  setSession(session) {
    this.session = session;
  }
  // Native-file lookup reuses the current backend session; it never logs in again.
  async nativeFileReference(payload, signal = AbortSignal.timeout(2e4)) {
    if (!this.session) throw new CollectorError("AUTH_REQUIRED");
    const n = nonce(), params = await auxiliaryEncrypted("GET", "/service/gen_download_url", { data: pythonJSON(payload) }, this.session.security, n);
    let r;
    try {
      r = await this.transport("https://hlth.io.mi.com" + NATIVE_FILE_PATH + "?" + new URLSearchParams(params), { method: "GET", redirect: "manual", signal, headers: { Cookie: this.session.cookies + "; userId=" + this.session.userId, region_tag: "cn" } });
    } catch (e) {
      if (e instanceof CollectorError) throw e;
      throw new CollectorError("NETWORK_FAILURE");
    }
    if (r.status !== 200) {
      await r.body?.cancel();
      if (r.status === 401 || r.status === 403) {
        this.session = null;
        throw new CollectorError("AUTH_EXPIRED");
      }
      throw new CollectorError(r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
    }
    let raw;
    try {
      raw = await boundedText(r);
    } catch (e) {
      if (e instanceof CollectorError) throw e;
      throw new CollectorError("NETWORK_FAILURE");
    }
    let body;
    try {
      body = object(JSON.parse(raw.startsWith("{") ? raw : text(rc4(await signedNonce(this.session.security, n), unb64(raw)))));
    } catch {
      throw new CollectorError("INVALID_CLOUD_RESPONSE");
    }
    if ([401, 403, -6, -10001, 2].includes(Number(body.code))) {
      this.session = null;
      throw new CollectorError("AUTH_EXPIRED");
    }
    if (body.code !== 0) throw new CollectorError("UPSTREAM_BUSINESS_ERROR");
    return object(body.result ?? {});
  }
  async request(path, payload) {
    if (!this.session) throw new CollectorError("AUTH_REQUIRED");
    allowedURL("https://hlth.io.mi.com" + path);
    const { form, key } = await encryptRequest(payload, path, this.session.security, this.makeNonce?.());
    let r;
    try {
      r = await this.transport("https://hlth.io.mi.com" + path, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(2e4), headers: { Cookie: this.session.cookies, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
    } catch (e) {
      if (e instanceof CollectorError) throw e;
      throw new CollectorError("NETWORK_FAILURE");
    }
    if (r.status === 401 || r.status === 403) {
      this.session = null;
      throw new CollectorError("AUTH_EXPIRED");
    }
    if (r.status !== 200) {
      await r.body?.cancel();
      throw new CollectorError(r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
    }
    let raw;
    try {
      raw = await boundedText(r);
    } catch (e) {
      if (e instanceof CollectorError) throw e;
      throw new CollectorError("NETWORK_FAILURE");
    }
    let body;
    try {
      body = object(JSON.parse(raw.startsWith("{") ? raw : text(rc4(key, unb64(raw)))));
    } catch {
      throw new CollectorError("INVALID_CLOUD_RESPONSE");
    }
    const code = body.code, message = String(body.message ?? "").toLowerCase();
    if ([401, 403, -6, -10001, 2].includes(Number(code)) || ["authentication failed", "invalid credential", "invalid pass token", "login required", "not logged in", "session expired", "unauthorized"].some((v) => message.includes(v))) {
      this.session = null;
      throw new CollectorError("AUTH_EXPIRED");
    }
    if (code !== 0) throw new CollectorError("UPSTREAM_BUSINESS_ERROR");
    return object(body.result ?? {});
  }
  async page(key, start, end, cursor) {
    const times = dateRange(start, end), payload = { start_time: times.start, end_time: times.end };
    if (key === "sport") payload.limit = 50;
    else payload.key = key;
    if (cursor) payload.next_key = cursor;
    if (key === "steps_daily_aggregate") {
      delete payload.start_time;
      delete payload.end_time;
      payload.startTime = times.start * 1e3;
      payload.endTime = (times.end + 1) * 1e3 - 1;
      payload.tag = "daily_report";
      payload.key = "steps";
      payload.reverse = true;
      if (cursor) {
        delete payload.next_key;
        payload.cursor = cursor;
      }
    }
    const result = await this.request(key === "sport" ? SPORT_PATH : key === "steps_daily_aggregate" ? AGGREGATE_PATH : FITNESS_PATH, payload), raw = result[key === "sport" ? "sport_records" : "data_list"] ?? [];
    if (!Array.isArray(raw)) throw new CollectorError("INVALID_PAGE");
    if (raw.length > 5e3) throw new CollectorError("PAGE_RECORD_LIMIT");
    if (result.has_more !== void 0 && typeof result.has_more !== "boolean") throw new CollectorError("INVALID_HAS_MORE");
    const next = result.next_key;
    if (next !== void 0 && next !== null && typeof next !== "string") throw new CollectorError("INVALID_CURSOR");
    if (typeof next === "string" && next.length > 4096) throw new CollectorError("INVALID_CURSOR");
    const belowWindow = key === "steps_daily_aggregate" && raw.some((x) => x && typeof x === "object" && Number.isSafeInteger(x.time) && Number(x.time) >= 0 && (x.sid === void 0 || typeof x.sid === "string") && Number(x.time) < times.start);
    const hasMore = result.has_more === true && !belowWindow;
    if (hasMore && !next) throw new CollectorError("CURSOR_MISSING");
    const records = [], rejected = [];
    for (const [index, item] of raw.entries()) {
      try {
        const r = object(item);
        if (!Number.isSafeInteger(r.time) || Number(r.time) < 0 || Number(r.time) > 4102444800) throw new CollectorError("INVALID_SECONDS_TIMESTAMP");
        if (r.sid !== void 0 && typeof r.sid !== "string") throw new CollectorError("INVALID_SID");
        if (Number(r.time) >= times.start && Number(r.time) <= times.end) records.push(r);
      } catch (e) {
        const reason = e instanceof CollectorError && ["INVALID_OBJECT", "INVALID_SECONDS_TIMESTAMP", "INVALID_SID"].includes(e.code) ? e.code : "INVALID_OBJECT";
        rejected.push({ raw: item, reason, index });
      }
    }
    return { records, hasMore, nextKey: hasMore ? String(next) : null, ...rejected.length ? { rejected } : {} };
  }
};

// src/collection-window-audit.ts
init_http();
init_parser();
var contract = "adjacent_overlap_v1";
var codes = /* @__PURE__ */ new Set(["AUTH_EXPIRED", "LOGIN_REJECTED", "LOGIN_HTTP_ERROR", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "INTERACTIVE_AUTH_REQUIRED", "NETWORK_FAILURE", "UPSTREAM_RATE_LIMITED", "UPSTREAM_HTTP_ERROR", "UPSTREAM_BUSINESS_ERROR", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "INVALID_PAGE", "INVALID_HAS_MORE", "INVALID_CURSOR", "CURSOR_MISSING", "PAGE_RECORD_LIMIT", "RAW_REDACTION_LIMIT", "AUDIT_REQUEST_LIMIT", "AUDIT_TIME_LIMIT", "AUDIT_PAGE_LIMIT", "AUDIT_QUARANTINED_SOURCE", "AUDIT_LEASE_LOST"]);
var keyFor = (date) => contract + ":" + date;
var identity = (r) => JSON.stringify([r.sid ?? "unknown", r.key ?? "", r.time]);
var members = (rows) => new Set(rows.map(identity));
var difference = (a, b) => [...a].filter((x) => !b.has(x)).length;
async function readWindowAudit(env, date) {
  dateRange(date, date);
  if (!env.DB) throw new CollectorError("DATABASE_NOT_READY");
  const old = await env.DB.prepare("SELECT status,audit_json FROM collection_window_audits WHERE audit_id=?").bind(keyFor(date)).first();
  return old ? { ...JSON.parse(old.audit_json), status: old.status, cached: true, network_requests_performed: false } : { status: "not_checked", cached: false, network_requests_performed: false };
}
async function auditCollectionWindows(env, date, transport = nativeFetcher(true)) {
  const day = dateRange(date, date), today = dateCN(Math.floor(Date.now() / 1e3));
  if (addDays(date, 1) >= today) throw new CollectorError("AUDIT_REQUIRES_CLOSED_WINDOWS");
  if (!env.DB || !env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
  if (Date.now() >= Date.parse("2027-01-01T00:00:00+08:00")) throw new CollectorError("HOSTING_COST_REVIEW_REQUIRED");
  const d = env.DB, prior = await readWindowAudit(env, date);
  if (prior.cached) return prior;
  const lease = "window_audit_" + crypto.randomUUID(), lock = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(lease, Date.now() + 18e4, Date.now()).run();
  if (!lock.meta.changes) throw new CollectorError("SYNC_BUSY_OR_NOT_INITIALIZED");
  const id = keyFor(date), began = Date.now(), budget = { login_attempts: 1, auth_http_requests: 2, health_requests: 6, pages_per_window: 1, retries: 0, elapsed_ms: 45e3 };
  const raw = [], pages = [], observations = /* @__PURE__ */ new Map();
  let health = 0, auth = 0, loginAttempts = 0, status = "complete", error = null;
  const report = () => ({ request_contract_version: contract, status, error_code: error, date, timezone: "Asia/Shanghai", budget, login_attempts: loginAttempts, auth_http_requests: auth, health_requests: health, retries: 0, pages, comparisons: [], upstream_upload_complete: "unknown", raw_preserved: "site_d1_collection_window_audits", regular_cache_written: false, checkpoints_advanced: false, checked_at: Date.now() });
  let claimed = false;
  try {
    const claim = await d.prepare("INSERT OR IGNORE INTO collection_window_audits(audit_id,status,audit_json,raw_json,checked_at) VALUES(?,'checking',?,'[]',?)").bind(id, JSON.stringify({ ...report(), status: "checking" }), began).run();
    if (!claim.meta.changes) return await readWindowAudit(env, date);
    claimed = true;
    const once = async (url, init) => {
      if (Date.now() - began >= budget.elapsed_ms) throw new CollectorError("AUDIT_TIME_LIMIT");
      const active = await d.prepare("SELECT 1 AS active FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?").bind(lease, Date.now()).first();
      if (!active) throw new CollectorError("AUDIT_LEASE_LOST");
      const isHealth = new URL(url).hostname === "hlth.io.mi.com";
      if (isHealth ? ++health > budget.health_requests : ++auth > budget.auth_http_requests) throw new CollectorError("AUDIT_REQUEST_LIMIT");
      let r;
      try {
        r = await transport(url, init);
      } catch {
        throw new CollectorError("NETWORK_FAILURE");
      }
      if (r.status !== 200) {
        await r.body?.cancel();
        throw new CollectorError(r.status === 401 || r.status === 403 ? "AUTH_EXPIRED" : r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
      }
      return r;
    };
    class AuditAdapter extends MiFitnessAdapter {
      async request(path, payload) {
        const result = await super.request(path, payload), clean = redactRawRecord(result);
        raw.push({ endpoint: path, payload, response: clean.value, redactions: clean.redactions, received_at: Date.now() });
        return result;
      }
    }
    const a = new AuditAdapter(once);
    loginAttempts++;
    await a.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
    const previous = addDays(date, -1), next = addDays(date, 1);
    for (const metric of ["sleep", "sport"]) {
      for (const [window, start, end] of [["adjacent", previous, previous], ["exact", date, date], ["overlap", previous, next]]) {
        const page = await a.page(metric, start, end, null);
        observations.set(metric + ":" + window, page.records);
        let differentNormalizedDate = 0;
        for (const r of page.records) {
          try {
            if (parseRecord(metric, r).date !== dateCN(r.time)) differentNormalizedDate++;
          } catch {
          }
        }
        pages.push({ metric, window, start_date: start, end_date: end, records: page.records.length, rejected: page.rejected?.length ?? 0, has_more: page.hasMore, source_vs_normalized_date_differences: differentNormalizedDate });
        if (page.rejected?.length) throw new CollectorError("AUDIT_QUARANTINED_SOURCE");
        if (page.hasMore) throw new CollectorError("AUDIT_PAGE_LIMIT");
      }
    }
  } catch (e) {
    error = e instanceof CollectorError && codes.has(e.code) ? e.code : "WINDOW_AUDIT_FAILED";
    status = ["AUDIT_PAGE_LIMIT", "AUDIT_QUARANTINED_SOURCE", "AUDIT_TIME_LIMIT"].includes(error) ? "partial" : "failed";
  } finally {
    try {
      if (claimed) {
        const audit = report();
        if (status === "complete") for (const metric of ["sleep", "sport"]) {
          const exact = observations.get(metric + ":exact"), adjacent = observations.get(metric + ":adjacent"), overlap = observations.get(metric + ":overlap");
          const target = overlap.filter((r) => r.time >= day.start && r.time <= day.end), both = overlap.filter((r) => r.time <= day.end), union = [...adjacent, ...exact];
          const e = members(exact), t = members(target), b = members(both), u = members(union);
          const cache = (await d.prepare("SELECT raw_json FROM raw_records WHERE metric=? AND recorded_at>=? AND recorded_at<=?").bind(metric, day.start, day.end).all()).results;
          const cached2 = [];
          for (const r of cache) {
            try {
              cached2.push(JSON.parse(r.raw_json));
            } catch {
            }
          }
          const payloadById = new Map(exact.map((r) => [identity(r), JSON.stringify(redactRawRecord(r).value)]));
          audit.comparisons.push({ metric, exact_only: difference(e, t), overlap_target_only: difference(t, e), adjacent_union_only: difference(u, b), overlap_two_days_only: difference(b, u), same_identity_payload_changed: target.filter((r) => payloadById.has(identity(r)) && payloadById.get(identity(r)) !== JSON.stringify(redactRawRecord(r).value)).length, fresh_target_identities_absent_from_cache: difference(members([...exact, ...target]), members(cached2)), conclusion: e.size === t.size && !difference(e, t) && !difference(t, e) ? "no_identity_difference_observed" : "window_difference_observed_cause_unverified", not_proof_of: "upload_completeness_boundary_loss_or_late_upload_cause" });
        }
        await d.prepare("UPDATE collection_window_audits SET status=?,audit_json=?,raw_json=?,checked_at=? WHERE audit_id=?").bind(status, JSON.stringify(audit), JSON.stringify(raw), audit.checked_at, id).run();
      }
    } finally {
      await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(lease).run();
    }
  }
  return { ...await readWindowAudit(env, date), cached: false, network_requests_performed: auth + health > 0 };
}

// src/activity-raw-repair.ts
init_http();

// src/activity-details.ts
init_http();

// src/workout-decoder.ts
init_http();
function decodeStrengthV4(bytes, expectedStart, expectedEnd) {
  const fail = () => {
    throw new CollectorError("NATIVE_FORMAT_INVALID_OR_UNSUPPORTED");
  };
  if (bytes.length < 23 || bytes.length > 2 * 1024 * 1024 || bytes[5] !== 4 || bytes[6] !== 8 || bytes[7] !== 0) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), flags = [bytes[8] >> 4, bytes[8] & 15, bytes[9] >> 4, bytes[9] & 15], width = flags.filter((n) => (n & 8) !== 0).length;
  if (!width) fail();
  let pos = 10, total = 0;
  const samples = [], segments = [];
  let invalid = 0, previous = -1;
  while (pos < bytes.length) {
    if (bytes.length - pos < 13 || segments.length >= 1e3) fail();
    const count = v.getUint32(pos, true), start = v.getUint32(pos + 4, true), state = bytes[pos + 8], duration = v.getUint32(pos + 9, true);
    pos += 13;
    if (!count || count > 21600 || total + count > 21600 || count * width > bytes.length - pos || start < previous) fail();
    if (expectedStart !== void 0 && start < expectedStart - 2 || expectedEnd !== void 0 && start + count > expectedEnd + 2) fail();
    segments.push({ start_at: start, point_count: count, source_state: state, source_duration: duration });
    for (let i = 0; i < count; i++) {
      let hr = null;
      for (let f = 0; f < 4; f++) {
        if (flags[f] & 8) {
          const x = bytes[pos++];
          if (f === 0 && flags[f] & 4) hr = x;
        }
      }
      if (hr !== null && hr > 0 && hr <= 255) samples.push({ at: start + i, bpm: hr });
      else invalid++;
    }
    total += count;
    previous = start + count;
  }
  return { samples, quality: { decoder: "strength-format8-record-v4", bytes_consumed: pos, point_count: total, valid_heart_rate_samples: samples.length, invalid_or_unavailable_heart_rate_points: invalid, nominal_point_interval_seconds: 1, sensor_measurement_cadence: "unknown_device_may_repeat_values", validity_nibbles: flags, segments, action_or_set_boundaries_available: false } };
}
async function cachedNativeCurve(env, ref, start, end) {
  const row = await env.DB.prepare("SELECT status,evidence_json,payload_base64,checked_at FROM workout_native_cache WHERE record_ref=?").bind(ref).first();
  if (!row) return { status: "not_checked", samples: [], quality: null, evidence: null, checked_at: null };
  if (!row.payload_base64) return { status: row.status, samples: [], quality: null, evidence: JSON.parse(row.evidence_json), checked_at: row.checked_at };
  try {
    const parsed = decodeStrengthV4(unb64(row.payload_base64), start, end);
    return { status: "decoded", ...parsed, evidence: { ...JSON.parse(row.evidence_json), error_code: null, decoder_status: "decoded" }, checked_at: row.checked_at };
  } catch {
    return { status: "downloaded_decoder_unverified", samples: [], quality: null, evidence: JSON.parse(row.evidence_json), checked_at: row.checked_at };
  }
}

// src/semantics.ts
var meta = (unit, meaning, kind, confidence, source, warning) => ({ unit, meaning, kind, confidence, source, ...warning ? { warning } : {} });
var dataContract = { version: "2.1", confidence_scope: "verified means schema/units/arithmetic checked, not clinical accuracy", kinds: { raw: "source value unchanged", converted: "unit conversion or enum decoding", calculated: "local aggregation with stated method" }, ai_rules: ["Never infer a unit when unit is null.", "Never treat an unverified field as confirmed.", "A closed calendar day does not establish upload completeness.", "Missing data is null, not zero.", "Workout calories and total_cal are distinct source fields; do not add them or substitute them.", "Source HRV values without verified units/algorithm are not a validated HRV trend."] };
function fieldSemantics(metric, fields2, raw = false) {
  const out = {};
  for (const key of Object.keys(fields2)) {
    let m = meta(null, "\u6E90\u5B57\u6BB5\uFF0C\u8BED\u4E49\u6216\u5355\u4F4D\u5C1A\u672A\u9A8C\u8BC1", "raw", "unverified", metric + ".value." + key);
    if (!raw) {
      const source = metric + ".value";
      if (["start_at", "end_at", "timestamp"].includes(key)) m = meta("unix_second", "\u5317\u4EAC\u65F6\u95F4\u663E\u793A\u7684\u65F6\u95F4\u6233", "converted", "verified", source);
      else if (["duration_minutes", "time_asleep_minutes", "time_awake_minutes", "in_bed_minutes", "session_minutes"].includes(key)) m = meta("minute", key === "duration_minutes" && metric === "sleep" ? "\u5B9E\u9645\u7761\u7720\u65F6\u957F\uFF0C\u542B\u6DF1\u7761/\u6D45\u7761/REM\uFF0C\u4E0D\u542B\u6E05\u9192" : "\u5BF9\u5E94\u65F6\u95F4\u6BB5\u7684\u5206\u949F\u6570", "converted", metric === "sleep" && fields2.quality && fields2.quality.status !== "validated" ? "source_reported" : "verified", source, metric === "sleep" ? "\u7761\u7720\u5206\u671F\u4EE5\u8BE5\u6761\u8BB0\u5F55\u7684 quality \u548C stage_mapping \u4E3A\u51C6" : void 0);
      else if (key === "duration_seconds") m = meta("second", "\u8FD0\u52A8\u65F6\u957F", "raw", "verified", source + ".duration");
      else if (key === "bpm" || key.endsWith("_heart_rate_bpm")) m = meta("bpm", "\u5FC3\u7387\u91C7\u6837\u6216\u8FD0\u52A8\u5FC3\u7387\u7EDF\u8BA1", "raw", "verified", source);
      else if (key === "steps") m = meta("step", "\u5206\u949F\u6B65\u6570\u589E\u91CF\uFF1B\u8DE8\u6765\u6E90\u4E0D\u53EF\u76F4\u63A5\u6C42\u548C", "raw", "verified", source + ".steps");
      else if (key === "spo2_pct") m = meta("percent", "\u8840\u6C27\u9971\u548C\u5EA6\u91C7\u6837", "raw", "verified", source + ".spo2");
      else if (key === "stress_score") m = meta("source_score_0_100", "\u5C0F\u7C73\u538B\u529B\u8BC4\u5206\uFF0C\u4E0D\u4EE3\u8868\u533B\u5B66\u8BCA\u65AD", "raw", "verified", source + ".stress");
      else if (key === "distance_m") m = meta("metre", "\u6E90\u8BB0\u5F55\u8DDD\u79BB", "raw", "source_reported", source + ".distance");
      else if (key === "calories_kcal" || key === "active_kcal") m = meta("kcal", "\u6E90 calories \u5B57\u6BB5\uFF1B\u5206\u949F\u8BB0\u5F55\u6216\u5355\u6B21\u8FD0\u52A8\u7684\u6D88\u8017", "raw", "source_reported", source + ".calories", "\u8BE5\u79C1\u6709\u63A5\u53E3\u672A\u8BC1\u5B9E\u6D3B\u52A8/\u51C0\u6D88\u8017\u7684\u7CBE\u786E\u5B9A\u4E49\uFF1B\u4E0D\u53EF\u4E0E total_cal \u76F8\u52A0");
      else if (key === "total_calories_kcal") m = meta("kcal", "\u6E90 total_cal \u5B57\u6BB5\uFF0C\u72EC\u7ACB\u4FDD\u7559", "raw", "source_reported", source + ".total_cal", "\u662F\u5426\u5305\u542B\u9759\u606F\u6D88\u8017\u5C1A\u672A\u9A8C\u8BC1\uFF0C\u4E0D\u66FF\u4EE3 calories");
      else if (key === "stages" || key === "stage_minutes") m = meta("minute", "\u5206\u671F\u679A\u4E3E\u8F6C\u6362\u53CA\u5206\u6BB5\u65F6\u957F\u7EDF\u8BA1", "calculated", fields2.stage_mapping === "unverified" ? "unverified" : "verified", source + ".items");
    } else if (["start_time", "end_time", "time", "bedtime", "wake_up_time"].includes(key)) m = meta("unix_second", "\u6E90\u65F6\u95F4\u6233", "raw", "verified", metric + ".value." + key);
    if (key === "recover_time" || key === "recovery_time_raw") m = meta(null, "\u6E90 recover_time \u6062\u590D\u6307\u6807\uFF1B\u5355\u4F4D\u672A\u9A8C\u8BC1", "raw", "unverified", "sport.value.recover_time", "\u4E0D\u80FD\u628A20\u89E3\u91CA\u4E3A20\u5C0F\u65F6\u3001\u5206\u949F\u6216\u79D2\uFF1B\u4E0D\u5F97\u7528\u4E8E\u786E\u5B9A\u6062\u590D\u5EFA\u8BAE");
    if (raw && ["calories", "total_cal"].includes(key)) m = meta("kcal", key === "calories" ? "\u6E90 calories \u6D88\u8017\u503C" : "\u6E90 total_cal \u6D88\u8017\u503C", "raw", "source_reported", "sport.value." + key, "\u4E24\u5B57\u6BB5\u5B9A\u4E49\u5DEE\u5F02\u672A\u7531\u8BE5\u79C1\u6709\u63A5\u53E3\u8BC1\u5B9E\uFF1B\u72EC\u7ACB\u4FDD\u7559\uFF0C\u4E0D\u80FD\u76F8\u52A0\u6216\u76F8\u4E92\u66FF\u4EE3");
    if (metric === "sleep" && key === "hrv") m = meta(null, "\u7761\u7720\u6E90HRV\u5B57\u6BB5\u96C6\u5408\uFF1B\u4E94\u4E2A\u5B57\u6BB5\u5355\u4F4D\u6709\u6240\u6709\u8005App\u5BF9\u8D26\uFF0C\u89C1\u9010\u5B57\u6BB5\u5143\u6570\u636E\uFF1B\u7B97\u6CD5\u672A\u9A8C\u8BC1", "raw", "unverified", "sleep.value", "\u4E0D\u5C06\u96F6\u5360\u4F4D\u89C6\u4E3A\u771F\u5B9EHRV\u96F6\u503C\uFF1B\u4E0D\u7531\u5FC3\u7387\u63A8\u7B97");
    if (raw && /hrv/i.test(key)) m = meta(null, "\u6E90 HRV \u76F8\u5173\u5B57\u6BB5\uFF0C\u7B97\u6CD5\u548C\u5355\u4F4D\u672A\u9A8C\u8BC1", "raw", "unverified", metric + ".value." + key);
    if (!raw && metric === "sport" && key === "duration_minutes") m = { ...meta("minute", "\u6E90\u8FD0\u52A8\u65F6\u957F\u6362\u7B97\u4E3A\u6574\u5206\u949F\uFF1B\u4FDD\u7559\u65E7\u63A5\u53E3\u5411\u4E0B\u53D6\u6574\u884C\u4E3A", "converted", "verified", "sport.value.duration"), method: "floor(duration_seconds / 60) || floor((end_at - start_at) / 60)" };
    if (!raw && metric === "sleep" && key === "in_bed_minutes") m = { ...meta("minute", "\u6E90\u5728\u5E8A\u8FB9\u754C\u4E4B\u95F4\u7684\u65F6\u957F\uFF1B\u4E0D\u7B49\u4E8E\u7761\u7720\u5206\u671F\u533A\u95F4", "calculated", "source_reported", "sleep.value.bed_timestamp,out_bed_timestamp"), method: "(out_bed_timestamp - bed_timestamp) / 60; unavailable boundaries fall back to session_minutes", warning: "\u53EF\u80FD\u5305\u542B\u5206\u671F\u533A\u95F4\u524D\u540E\u65F6\u95F4\uFF1B\u4E0D\u80FD\u5F53\u4F5C\u5B9E\u9645\u7761\u7720\u65F6\u957F" };
    if (!raw && metric === "sleep" && key === "session_minutes") m = { ...meta("minute", "\u89E3\u6790\u9009\u7528\u7684\u5165\u7761\u81F3\u9192\u6765\u8FB9\u754C\u4E4B\u95F4\u7684\u65F6\u957F", "calculated", "verified", "sleep.value.bedtime,wake_up_time (fallback paths in time_boundaries)"), method: "(end_at - start_at) / 60" };
    if (raw && metric === "sport" && ["avg_hrm", "max_hrm", "min_hrm"].includes(key)) m = meta("bpm", "\u6E90\u8FD0\u52A8\u5FC3\u7387\u7EDF\u8BA1\uFF1B\u6C47\u603B\u7B97\u6CD5\u672A\u9A8C\u8BC1", "raw", "source_reported", "sport.value." + key);
    if (raw && metric === "sport" && key === "duration") m = meta("second", "\u6E90\u8FD0\u52A8\u65F6\u957F\uFF1B\u4E0E\u539F\u751F\u6587\u4EF6\u8BB0\u5F55\u533A\u95F4\u4EA4\u53C9\u6838\u5BF9", "raw", "source_reported", "sport.value.duration", "\u72EC\u7ACB\u4FDD\u7559\uFF1B\u53EF\u80FD\u4E0E end_time-start_time \u5B58\u5728\u8FB9\u754C\u5DEE\u5F02");
    if (raw && ["bed_timestamp", "out_bed_timestamp"].includes(key)) m = meta("unix_second", "\u6E90\u5728\u5E8A\u8FB9\u754C\u65F6\u95F4\u6233", "raw", "source_reported", metric + ".value." + key);
    out[key] = m;
  }
  return out;
}

// src/hrv-evidence.ts
init_http();
init_parser();
init_hrv_source();
var reconciledHRVFields = ["avg_hrv", "max_hrv", "min_hrv", "hrv_base_min", "hrv_base_max"];
async function readHRVEvidence(env, start, end) {
  const r = await env.DB.prepare("SELECT policy_json FROM aggregation_policies WHERE metric>=? AND metric<=?").bind("hrv_app_reference:" + start, "hrv_app_reference:" + end).all();
  return r.results.map((x) => JSON.parse(x.policy_json));
}
function attachHRVEvidence(bundle, date, recordRef, evidence) {
  const ref = evidence.find((x) => x.date === date), matches = ref ? ref.matched_record_refs.includes(recordRef) && reconciledHRVFields.every((k) => bundle.source_fields[k] === ref.fields[k]) : null;
  return { ...bundle, app_reconciliation: { status: ref ? matches ? "matched" : "mismatch" : "no_reference", record_app_reconciled: matches, reference_date: ref?.date ?? null, verified_at: ref?.saved_at ?? null, method: ref?.method ?? null }, field_metadata: Object.fromEntries(Object.entries(bundle.field_metadata).map(([k, m]) => [k, { ...m, ...reconciledHRVFields.includes(k) ? { verification: { ..."verification" in m ? m.verification : {}, record_app_reconciled: matches, reference_date: ref?.date ?? null, private_evidence_persisted: !!ref } } : {} }])) };
}
async function saveHRVEvidence(env, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CollectorError("INVALID_HRV_REFERENCE");
  const b = input;
  if (Object.keys(b).some((k) => !["date", "app_values"].includes(k)) || typeof b.date !== "string") throw new CollectorError("INVALID_HRV_REFERENCE");
  dateRange(b.date, b.date);
  if (!b.app_values || typeof b.app_values !== "object" || Array.isArray(b.app_values)) throw new CollectorError("INVALID_HRV_REFERENCE");
  const fields2 = b.app_values;
  if (Object.keys(fields2).length !== reconciledHRVFields.length || reconciledHRVFields.some((k) => typeof fields2[k] !== "number" || !Number.isFinite(fields2[k]) || fields2[k] <= 0)) throw new CollectorError("INVALID_HRV_REFERENCE");
  const rows = (await env.DB.prepare("SELECT record_id,raw_json FROM raw_records WHERE metric='sleep' AND date_cn=?").bind(b.date).all()).results;
  const refs = rows.filter((r) => {
    const h = sleepHRVFromRaw(r.raw_json);
    return h.has_positive_source_average && reconciledHRVFields.every((k) => h.source_fields[k] === fields2[k]);
  }).map((r) => r.record_id);
  if (!refs.length) throw new CollectorError("HRV_REFERENCE_MISMATCH");
  const evidence = { date: b.date, fields: fields2, matched_record_refs: refs, saved_at: Date.now(), method: "owner_reported_app_reconciliation" };
  await env.DB.prepare("INSERT INTO aggregation_policies(metric,policy_json,verified_at) VALUES(?,?,?) ON CONFLICT(metric) DO UPDATE SET policy_json=excluded.policy_json,verified_at=excluded.verified_at").bind("hrv_app_reference:" + b.date, JSON.stringify(evidence), evidence.saved_at).run();
  return { status: "matched", date: b.date, matched_records: refs.length, verified_fields: reconciledHRVFields, unit: "ms", algorithm_verified: false, evidence_stored: "site_d1", raw_records_modified: false };
}

// src/daily-health.ts
init_hrv_source();

// src/freshness.ts
function freshness(sample, date, today, now = Date.now()) {
  const age = sample === null ? null : Math.max(0, Math.floor(now / 1e3) - sample), threshold = 1800;
  return { latest_sample_at: sample, sample_age_seconds: age, freshness_status: sample === null ? "no_cached_sample" : date !== today ? "historical_date_not_live_freshness_target" : age <= threshold ? "within_display_threshold" : "older_than_display_threshold", display_threshold_seconds: threshold, cloud_upload_complete: "unknown", warning: "30 minute display policy is not a device sampling guarantee or proof that data was not uploaded" };
}

// src/daily-health.ts
init_parser();
function normalizedData(metric, raw) {
  try {
    return parseRecord(metric, JSON.parse(raw)).data;
  } catch {
    return null;
  }
}
var sumAvailable = (r, key) => r.length && r.every((x) => typeof x.data[key] === "number") ? r.reduce((s, x) => s + Number(x.data[key]), 0) : null;
var round = (n) => Math.round(n * 1e3) / 1e3;
function stats(values) {
  return values.length ? { samples: values.length, min: Math.min(...values), max: Math.max(...values), mean: round(values.reduce((s, n) => s + n, 0) / values.length) } : { samples: 0, min: null, max: null, mean: null };
}
function canonicalIntervals(rows) {
  const sorted = rows.filter((r) => typeof r.data.start_at === "number" && typeof r.data.end_at === "number").sort((a, b) => Number(a.data.start_at) - Number(b.data.start_at) || b.synced_at - a.synced_at), out = [];
  let omitted = 0;
  for (const row of sorted) {
    const duplicate = out.findIndex((x) => Number(row.data.start_at) < Number(x.data.end_at) && Number(row.data.end_at) > Number(x.data.start_at));
    if (duplicate < 0) out.push(row);
    else {
      omitted++;
      const old = out[duplicate];
      if (Number(row.data.end_at) - Number(row.data.start_at) > Number(old.data.end_at) - Number(old.data.start_at)) out[duplicate] = row;
    }
  }
  return { rows: out, overlap_records_excluded: omitted };
}
async function buildDaily(env, date) {
  const hrvEvidence = await readHRVEvidence(env, date, date);
  const d = env.DB, all = (await d.prepare("SELECT record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at FROM raw_records WHERE date_cn=? ORDER BY recorded_at,record_id LIMIT 12001").bind(date).all()).results;
  const rows = all.slice(0, 12e3).map((r) => {
    const data = normalizedData(r.metric, r.raw_json);
    if (r.metric === "sleep" && data) data.hrv = attachHRVEvidence(sleepHRVFromRaw(r.raw_json), r.date_cn, r.record_id, hrvEvidence);
    return { ...r, data };
  }), parsed = rows.filter((r) => r.data !== null), by = (m) => parsed.filter((r) => r.metric === m);
  const counts = [...new Set(rows.map((r) => r.metric))].map((metric) => {
    const v = rows.filter((r) => r.metric === metric);
    return { metric, records: v.length, parsed: v.filter((x) => x.data !== null).length, sources: new Set(v.map((x) => x.source_hash)).size, latest_record_at: Math.max(...v.map((x) => x.recorded_at)) };
  });
  const quarantined = await d.prepare("SELECT COUNT(*) AS n FROM ingestion_quarantine WHERE requested_start<=? AND requested_end>=?").bind(date, date).first();
  const warnings = [];
  if (quarantined?.n) warnings.push("SOURCE_RECORDS_QUARANTINED_FOR_REQUEST_WINDOW");
  if (all.length > 12e3) warnings.push("SUMMARY_RECORD_LIMIT");
  if (rows.some((r) => !r.data)) warnings.push("UNPARSED_RECORDS");
  const aggregate = by("steps_daily_aggregate"), distinctSteps = [...new Set(aggregate.map((r) => r.data.value).filter((x) => typeof x === "number"))];
  const policy = await d.prepare("SELECT policy_json,verified_at FROM aggregation_policies WHERE metric='steps'").first();
  const p = policy ? JSON.parse(policy.policy_json) : null;
  const reference = await d.prepare("SELECT app_steps FROM step_references WHERE date_cn=?").bind(date).first();
  const reportVerified = p?.strategy === "cloud_daily_aggregate", steps = reportVerified && distinctSteps.length === 1 ? Number(distinctSteps[0]) : null;
  if (distinctSteps.length > 1) warnings.push("DAILY_STEPS_REPORT_CONFLICT");
  if (steps === null) warnings.push("DAILY_STEPS_NOT_VERIFIED");
  const stepRows = by("steps"), stepRawSum = stepRows.reduce((s, r) => s + Number(r.data.steps), 0), stepSourceCount = new Set(stepRows.map((x) => x.source_hash)).size;
  if (stepSourceCount > 1) warnings.push("STEP_MINUTE_SOURCES_OVERLAP_NOT_SUMMED");
  const rest = [...new Map(by("resting_heart_rate").map((r) => [r.data.timestamp ?? r.recorded_at, Number(r.data.bpm)])).values()].sort((a, b) => a - b), rhr = rest.length ? rest.length % 2 ? rest[(rest.length - 1) / 2] : (rest[rest.length / 2 - 1] + rest[rest.length / 2]) / 2 : null;
  const sleep = canonicalIntervals(by("sleep")), sleepRows = sleep.rows.sort((a, b) => Number(b.data.time_asleep_minutes ?? 0) - Number(a.data.time_asleep_minutes ?? 0)), main = sleepRows[0] ?? null;
  let sleepMinutes = null;
  if (sleepRows.length && sleepRows.every((r) => typeof r.data.time_asleep_minutes === "number")) sleepMinutes = round(sleepRows.reduce((s, r) => s + Number(r.data.time_asleep_minutes), 0));
  if (sleepRows.some((r) => r.data.quality?.status !== "validated")) warnings.push("SLEEP_PARTIAL_OR_INCONSISTENT");
  if (sleepRows.some((r) => r.data.source_complete === false)) warnings.push("SLEEP_SOURCE_MARKED_INCOMPLETE");
  if (sleep.overlap_records_excluded) warnings.push("OVERLAPPING_SLEEP_RECORDS_NOT_SUMMED");
  const workouts = canonicalIntervals(by("sport")), exercise = workouts.rows.length ? round(workouts.rows.reduce((s, r) => s + Number(r.data.duration_seconds ?? Number(r.data.duration_minutes) * 60), 0) / 60) : null;
  const sampleMetric = (metric, field, unit) => {
    const source = by(metric), groups = /* @__PURE__ */ new Map();
    for (const r of source) {
      const v = Number(r.data[field]);
      if (!Number.isFinite(v)) continue;
      const set = groups.get(r.recorded_at) ?? /* @__PURE__ */ new Set();
      set.add(v);
      groups.set(r.recorded_at, set);
    }
    const conflicts = [...groups.values()].filter((s) => s.size > 1).length, dedup = [...groups.values()].filter((s) => s.size === 1).map((s) => [...s][0]), first = source[0]?.recorded_at ?? null, last = source.at(-1)?.recorded_at ?? null;
    return { ...stats(dedup), unit, kind: "calculated", confidence: dedup.length ? conflicts ? "source_reported" : "verified" : "unverified", conflicting_timestamps_excluded: conflicts, source: metric, method: "unweighted_mean_of_unique_timestamp_samples_not_a_daily_vendor_average", first_sample_at: first, last_sample_at: last, complete_day_coverage: false };
  };
  const spoil = sampleMetric("spo2", "spo2_pct", "percent"), stress = sampleMetric("stress", "stress_score", "source_score_0_100"), heart = sampleMetric("heart_rate", "bpm", "bpm");
  const latest = [...new Set(parsed.map((r) => r.metric))].map((metric) => {
    const r = by(metric).at(-1);
    return { metric, at: r.recorded_at, data: r.data, field_metadata: fieldSemantics(metric, r.data), meaning: "latest_observation_not_daily_total" };
  });
  const job = await d.prepare("SELECT start_date,end_date,complete,updated_at FROM sync_jobs WHERE id=1").first(), perMetric = (await d.prepare("SELECT metric,status,record_count,error_code,at FROM sync_logs WHERE date_cn=? AND status IN ('page_committed','failed') ORDER BY id DESC LIMIT 100").bind(date).all()).results;
  const latestSync = [...new Set(perMetric.map((r) => r.metric))].map((m) => perMetric.find((r) => r.metric === m));
  const today = dateCN(Math.floor(Date.now() / 1e3)), dataAt = rows.length ? Math.max(...rows.map((r) => r.synced_at)) : null, calendar = date === today ? "in_progress" : date < today ? "complete_day" : "future";
  if (calendar === "in_progress") warnings.push("DAY_IN_PROGRESS");
  if (!rows.length) warnings.push("NO_DATA");
  const appReconciled = !!reference && steps !== null && reference.app_steps === steps, stepConfidence = steps === null ? "unverified" : appReconciled ? "verified" : "source_reported";
  const summary = { date_cn: date, steps, steps_sample_sum: stepRows.length ? stepRawSum : null, steps_record_count: stepRows.length, step_semantics: steps === null ? "unverified" : appReconciled ? "cloud_daily_report_app_reference_verified" : "cloud_daily_report_not_app_reconciled_for_date", resting_hr: rhr, sleep_minutes: sleepMinutes, active_kcal: null, exercise_minutes: exercise, spo2_mean_pct: spoil.mean, stress_mean_score: stress.mean, synced_at: dataAt };
  return { date, day_status: calendar, summary, counts, latest_observations: latest, metrics: { steps: { value: steps, unit: "step", kind: "raw", confidence: stepConfidence, source: "get_aggregated_fitness_data_by_time:daily_report/steps", method: "cloud_report_not_sum_of_minute_sources", app_reference_verified_dates: p?.verified_dates ?? [], source_schema_validated: reportVerified, app_reconciled_for_date: appReconciled, app_reference_for_date: reference?.app_steps ?? null, app_reference_match_for_date: reference && steps !== null ? reference.app_steps === steps : null, raw_minute_sum: stepRows.length ? stepRawSum : null, raw_sum_is_daily_total: false, source_count: stepSourceCount }, resting_heart_rate: { value: rhr, unit: "bpm", kind: rest.length === 1 ? "raw" : "calculated", confidence: rhr !== null ? "verified" : "unverified", source: "resting_heart_rate.value.bpm", method: "median_of_unique_same_day_resting_samples", samples: rest.length }, sleep: { total_asleep_minutes: sleepMinutes, main_sleep: main?.data ?? null, additional_sessions: sleepRows.slice(1).map((r) => ({ start_at: r.data.start_at, end_at: r.data.end_at, asleep_minutes: r.data.time_asleep_minutes, classification: r.data.is_nap === true ? "source_marked_nap" : "additional_sleep_session" })), sessions: sleepRows.length, unit: "minute", kind: "calculated", confidence: sleepMinutes !== null && sleepRows.every((r) => r.data.quality?.status === "validated") ? "verified" : "source_reported", source: "sleep", method: "non_overlapping_sessions_assigned_to_wake_date", overlap_records_excluded: sleep.overlap_records_excluded }, workouts: { sessions: workouts.rows.length, duration_minutes: exercise, source_calories_kcal: sumAvailable(workouts.rows, "calories_kcal"), source_total_cal_kcal: sumAvailable(workouts.rows, "total_calories_kcal"), calories_semantics: "source_reported_scope_unverified_do_not_add_calories_and_total_cal", records: workouts.rows.map((r) => ({ record_ref: r.record_id, ...r.data, field_metadata: fieldSemantics("sport", r.data) })), kind: "calculated", confidence: exercise !== null ? "verified" : "unverified", overlap_records_excluded: workouts.overlap_records_excluded }, heart_rate: heart, spo2: spoil, stress, active_calories: { value: null, unit: "kcal", confidence: "unverified", reason: "MINUTE_CALORIE_SOURCES_OVERLAP_AND_WORKOUT_SCOPE_IS_NOT_DAILY_ACTIVE_TOTAL" } }, field_metadata: { steps_sample_sum: { unit: "step", kind: "calculated", confidence: "unverified", meaning: "\u6240\u6709\u6765\u6E90\u660E\u7EC6\u503C\u76F4\u63A5\u76F8\u52A0\u7684\u8BCA\u65AD\u503C\uFF0C\u7981\u6B62\u4F5C\u4E3A\u6BCF\u65E5\u6B65\u6570" }, steps_record_count: { unit: "record", kind: "calculated", confidence: "verified" }, step_semantics: { unit: null, kind: "calculated", meaning: "\u6B65\u6570\u53E3\u5F84\u72B6\u6001" }, synced_at: { unit: "unix_millisecond", kind: "raw", meaning: "\u6700\u8FD1\u5065\u5EB7\u8BB0\u5F55\u5165\u5E93\u65F6\u95F4" }, steps: { unit: "step", meaning: appReconciled ? "\u4E91\u7AEF\u65E5\u62A5\u6B65\u6570\uFF1B\u5DF2\u4E0E\u8BE5\u65E5\u671FApp\u53C2\u8003\u503C\u5BF9\u8D26" : "\u4E91\u7AEF\u65E5\u62A5\u6B65\u6570\uFF1B\u8BE5\u65E5\u671F\u672A\u4E0EApp\u53C2\u8003\u503C\u5BF9\u8D26", kind: "raw", confidence: stepConfidence, source: "daily_report/steps" }, resting_hr: { unit: "bpm", kind: rest.length === 1 ? "raw" : "calculated", method: "median", source: "resting_heart_rate" }, sleep_minutes: { unit: "minute", kind: "calculated", meaning: "\u6309\u9192\u6765\u65E5\u671F\u5F52\u5C5E\u7684\u975E\u91CD\u53E0\u7761\u7720\u65F6\u957F\uFF0C\u542B\u989D\u5916\u7761\u7720\u6BB5", source: "sleep" }, exercise_minutes: { unit: "minute", kind: "calculated", method: "sum_unique_workout_duration_seconds_divided_by_60", source: "sport" }, active_kcal: { unit: "kcal", confidence: "unverified", reason: "daily total not established" }, spo2_mean_pct: { unit: "percent", kind: "calculated", method: "mean_of_observed_samples" }, stress_mean_score: { unit: "source_score_0_100", kind: "calculated", method: "mean_of_observed_samples" } }, quality: { quarantined_records_for_request_window: quarantined?.n ?? 0, status: rows.length ? warnings.some((x) => ["SUMMARY_RECORD_LIMIT", "UNPARSED_RECORDS", "DAILY_STEPS_NOT_VERIFIED", "SLEEP_PARTIAL_OR_INCONSISTENT", "SOURCE_RECORDS_QUARANTINED_FOR_REQUEST_WINDOW"].includes(x)) ? "partial" : "validated_with_limits" : quarantined?.n ? "quarantined_source_only" : "no_data", warnings, completeness: { calendar_day_closed: calendar === "complete_day", cloud_upload_complete: "unknown", summary_truncated: all.length > 12e3, heart_rate_sample_count: heart.samples, metric_count: counts.length, missing_metrics: ["steps", "resting_heart_rate", "sleep", "sport", "spo2", "stress"].filter((m) => !counts.some((c) => c.metric === m)), note: "\u6837\u672C\u5747\u503C\u4E0E\u4E91\u7AEF\u65E5\u5747\u503C\u4E0D\u540C\uFF1B\u65E0\u8FD0\u52A8\u8BB0\u5F55\u4E0D\u80FD\u8BC1\u660E\u5168\u5929\u672A\u8FD0\u52A8" } }, sync: { task_completed_at: job?.complete ? job.updated_at : null, latest_record_timestamp: counts.length ? Math.max(...counts.map((c) => c.latest_record_at)) : null, timestamp_warning: "record timestamp may be a daily bucket or session end, not a live sample", per_metric_freshness: counts.map((c) => ({ freshness: freshness(["heart_rate", "spo2", "stress", "resting_heart_rate", "steps"].includes(c.metric) ? c.latest_record_at : null, date, today), metric: c.metric, latest_record_at: c.latest_record_at, latest_sample_at: ["heart_rate", "spo2", "stress", "resting_heart_rate", "steps"].includes(c.metric) ? c.latest_record_at : null, last_ingested_at: Math.max(...rows.filter((r) => r.metric === c.metric).map((r) => r.synced_at)), sample_age_seconds: ["heart_rate", "spo2", "stress", "resting_heart_rate", "steps"].includes(c.metric) ? Math.max(0, Math.floor(Date.now() / 1e3) - c.latest_record_at) : null, cloud_upload_complete: "unknown" })), last_data_synced_at: dataAt, live_window: job, metric_results: latestSync, network_requests_performed: false }, hrv: { status: "unverified", reason: "SLEEP_SOURCE_HRV_PARTIAL_UNIT_VERIFICATION_ALGORITHM_UNVERIFIED", unit: null, algorithm: null, validated_hrv_metric: false, main_sleep_record_ref: main?.record_id ?? null, main_sleep: main ? attachHRVEvidence(sleepHRVFromRaw(main.raw_json), main.date_cn, main.record_id, hrvEvidence) : null, records: rows.filter((r) => r.metric === "sleep").map((r) => ({ sleep_record_ref: r.record_id, recorded_at: r.recorded_at, ...attachHRVEvidence(sleepHRVFromRaw(r.raw_json), r.date_cn, r.record_id, hrvEvidence) })) }, source: "xiaomi_cloud", timezone: "Asia/Shanghai", data_contract: dataContract };
}

// src/activity-details.ts
init_parser();
function projectHealth(v, maxArray = 2e3, depth = 0) {
  if (depth > 8) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.slice(0, maxArray).map((x) => projectHealth(x, maxArray, depth + 1));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (/(?:id$|sid|mac|imei|imsi|phone|lat|lon|lng|gps|route|track|coordinate|location|address|token|cookie|password|security|user)/i.test(k)) continue;
      if (typeof x === "string") {
        if (/^(?:bpm|kg|kcal|km|m|s|ms|mmHg|mmol\/L|mg\/dL|running|cycling|walking|workout)$/.test(x)) out[k] = x;
        else {
          try {
            out[k] = projectHealth(JSON.parse(x), maxArray, depth + 1);
          } catch {
          }
        }
      } else out[k] = projectHealth(x, maxArray, depth + 1);
    }
    return out;
  }
  return null;
}
function operationalRequest(raw) {
  const p = value(raw);
  return { sid: raw.sid, key: raw.key, start_time: p.start_time ?? raw.time, end_time: p.end_time ?? (p.start_time ?? raw.time) + Number(p.duration ?? 0), locale: "zh_cn" };
}
async function preserveOperationalResponse(d, ref, result, retainEmptyProjection = false) {
  const preserved = redactRawRecord(result), rawJson = JSON.stringify(preserved.value), at = Date.now(), hash2 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawJson))), (b) => b.toString(16).padStart(2, "0")).join("");
  let projection = null, cleanJson = null;
  try {
    projection = projectHealth(result);
    cleanJson = JSON.stringify(projection);
  } catch {
  }
  const hasProjection = !sourceResponseEmpty(projection);
  const old = retainEmptyProjection && !hasProjection ? await d.prepare("SELECT clean_json,fetched_at FROM activity_details WHERE record_ref=?").bind(ref).first() : null;
  const retained = !!old?.clean_json;
  if (retained) cleanJson = old.clean_json;
  const empty = sourceResponseEmpty(preserved.value), meta2 = JSON.stringify({ preservation_version: "redacted_complete_response_v1", raw_fetched_at: at, redactions: preserved.redactions, source_response_empty: empty, source_response_empty_rule: "no_nonempty_leaf_v1", projection_status: retained ? "retained_existing_projection_empty_new_projection" : cleanJson === null ? "unavailable" : "available", ...retained ? { projection_source_fetched_at: old.fetched_at } : {} });
  await d.batch([d.prepare("INSERT INTO activity_detail_versions(record_ref,payload_hash,raw_json,raw_meta_json,fetched_at) VALUES(?,?,?,?,?) ON CONFLICT(record_ref,payload_hash) DO NOTHING").bind(ref, hash2, rawJson, meta2, at), d.prepare("UPDATE activity_details SET status=?,raw_json=?,raw_meta_json=?,clean_json=?,error_code=NULL,fetched_at=? WHERE record_ref=?").bind(cleanJson === null ? "raw_saved_projection_unavailable" : "fetched", rawJson, meta2, cleanJson, at, ref)]);
  return { raw_response_available: true, source_response_empty: empty, raw_characters: rawJson.length, projection_retained: retained, raw_fetched_at: at };
}
async function fetchActivityDetails(env, adapter, start, end) {
  const d = env.DB;
  const range = start && end ? [start, end] : [];
  await d.prepare("INSERT OR IGNORE INTO activity_details(record_ref,status) SELECT record_id,'pending' FROM raw_records WHERE metric='sport'" + (range.length ? " AND date_cn>=? AND date_cn<=?" : "")).bind(...range).run();
  const pending = (await d.prepare("SELECT a.record_ref,r.raw_json FROM activity_details a JOIN raw_records r ON r.record_id=a.record_ref WHERE a.status='pending'" + (range.length ? " AND r.date_cn>=? AND r.date_cn<=?" : "") + " ORDER BY r.recorded_at DESC LIMIT 2").bind(...range).all()).results;
  for (const row of pending) {
    const r = JSON.parse(row.raw_json);
    let p;
    try {
      p = value(r);
    } catch {
      await d.prepare("UPDATE activity_details SET status='schema_unverified',fetched_at=? WHERE record_ref=?").bind(Date.now(), row.record_ref).run();
      continue;
    }
    try {
      const result = await adapter.request(SPORT_OPERATIONAL_PATH, operationalRequest(r));
      await preserveOperationalResponse(d, row.record_ref, result);
    } catch (e) {
      const fatal = e instanceof CollectorError && ["AUTH_EXPIRED", "INTERACTIVE_AUTH_REQUIRED", "NETWORK_FAILURE", "UPSTREAM_HTTP_ERROR", "UPSTREAM_RATE_LIMITED", "UPSTREAM_BUSINESS_ERROR", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "UPSTREAM_RETRY_DEFERRED", "UPSTREAM_RETRY_EXHAUSTED"].includes(e.code);
      await d.prepare("UPDATE activity_details SET status='unavailable',error_code=?,fetched_at=? WHERE record_ref=?").bind(fatal ? e.code : "DETAIL_REQUEST_FAILED", Date.now(), row.record_ref).run();
      if (fatal) throw e;
    }
  }
}
async function activityDetail(env, ref, includeSamples = false, limit = 1e3) {
  if (!/^[A-Za-z0-9+/_=-]{8,100}$/.test(ref) || !Number.isInteger(limit) || limit < 1 || limit > 2e3) throw new Error("INVALID_DETAIL_QUERY");
  const d = env.DB, r = await d.prepare("SELECT recorded_at,clean_json,raw_json FROM raw_records WHERE metric='sport' AND record_id=?").bind(ref).first();
  if (!r) return { status: "not_found" };
  const summary = normalizedData("sport", r.raw_json), raw = JSON.parse(r.raw_json);
  let source;
  try {
    source = projectHealth(value(raw), includeSamples ? limit : 0);
  } catch {
    source = null;
  }
  const operational = await d.prepare("SELECT status,clean_json,error_code,fetched_at,raw_json,raw_meta_json FROM activity_details WHERE record_ref=?").bind(ref).first();
  let heart = [];
  if (includeSamples && summary) {
    heart = (await d.prepare("SELECT recorded_at AS at,json_extract(clean_json,'$.bpm') AS bpm FROM raw_records WHERE metric='heart_rate' AND clean_json IS NOT NULL AND recorded_at>=? AND recorded_at<=? ORDER BY recorded_at LIMIT ?").bind(summary.start_at, summary.end_at, limit + 1).all()).results;
  }
  const native = await cachedNativeCurve(env, ref, Number(summary?.start_at), Number(summary?.end_at));
  let projectionMeta = {};
  try {
    projectionMeta = JSON.parse(operational?.raw_meta_json ?? "{}");
  } catch {
  }
  const projectionStatus = ["available", "unavailable", "retained_existing_projection_empty_new_projection"].includes(String(projectionMeta.projection_status)) ? String(projectionMeta.projection_status) : "legacy_or_unverified";
  const projectionAt = projectionStatus === "retained_existing_projection_empty_new_projection" ? projectionMeta.projection_source_fetched_at : projectionMeta.raw_fetched_at ?? operational?.fetched_at;
  let responseEmpty = null;
  try {
    if (operational?.raw_json) responseEmpty = sourceResponseEmpty(redactRawRecord(JSON.parse(operational.raw_json)).value);
  } catch {
  }
  return { operational_response_empty: responseEmpty, operational_projection: { status: projectionStatus, source_fetched_at: typeof projectionAt === "number" && Number.isSafeInteger(projectionAt) && projectionAt >= 0 ? projectionAt : null }, native_curve: { status: native.status, error_code: native.evidence?.error_code ?? null, quality: native.quality, total_samples: native.samples.length, checked_at: native.checked_at }, native_heart_rate_samples: includeSamples ? native.samples.slice(0, limit) : [], native_samples_truncated: includeSamples && native.samples.length > limit, native_samples_tool: "get_activity_heart_rate_samples", record_ref: ref, summary, field_metadata: fieldSemantics("sport", summary ?? {}), source_field_metadata: fieldSemantics("sport", source ?? {}, true), data_contract: dataContract, source_numeric_fields: source, operational_raw_available: operational?.raw_json != null, operational_raw_read: operational?.raw_json != null ? { tool: "get_raw_record", record_ref: ref, component: "activity_operational" } : null, operational_raw_missing_reason: operational?.raw_json == null ? operational?.status === "fetched" ? "LEGACY_PROJECTED_CACHE_NO_RAW_RESPONSE" : "RAW_NOT_FETCHED" : null, operational_status: operational?.status ?? "pending", operational_data: operational?.clean_json ? projectHealth(JSON.parse(operational.clean_json), includeSamples ? limit : 0) : null, heart_rate_samples: heart.slice(0, limit), samples_truncated: heart.length > limit, series_source: "daily_heart_rate_samples_in_workout_time_range_not_native_workout_frequency", gps_and_identifiers_excluded: true, timezone: "Asia/Shanghai" };
}

// src/activity-raw-repair.ts
function validateRef(ref) {
  if (typeof ref !== "string" || !/^[A-Za-z0-9+/_=-]{8,100}$/.test(ref)) throw new CollectorError("INVALID_RECORD_REF");
}
var errors = /* @__PURE__ */ new Set(["AUTH_EXPIRED", "LOGIN_REJECTED", "LOGIN_HTTP_ERROR", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "INTERACTIVE_AUTH_REQUIRED", "NETWORK_FAILURE", "UPSTREAM_RATE_LIMITED", "UPSTREAM_HTTP_ERROR", "UPSTREAM_BUSINESS_ERROR", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "RAW_REDACTION_LIMIT", "REPAIR_REQUEST_LIMIT", "REPAIR_TIME_LIMIT", "SYNC_LEASE_LOST"]);
async function readActivityRawRepair(env, ref) {
  validateRef(ref);
  if (!env.DB) throw new CollectorError("DATABASE_NOT_READY");
  const d = env.DB;
  const source = await d.prepare("SELECT date_cn FROM raw_records WHERE metric='sport' AND record_id=?").bind(ref).first();
  if (!source) return { status: "not_found", eligible: false, raw_response_available: false, network_requests_performed: false };
  const cache = await d.prepare("SELECT status,raw_json,raw_meta_json FROM activity_details WHERE record_ref=?").bind(ref).first();
  const prior = await d.prepare("SELECT status,audit_json FROM activity_raw_repairs WHERE record_ref=?").bind(ref).first();
  if (cache?.raw_json) {
    let empty = null;
    try {
      empty = sourceResponseEmpty(redactRawRecord(JSON.parse(cache.raw_json)).value);
    } catch {
    }
    return { status: "already_available", eligible: false, raw_response_available: true, source_response_empty: empty, source_date: source.date_cn, cached: true, repair_status: prior?.status ?? null, network_requests_performed: false };
  }
  if (prior) return { ...JSON.parse(prior.audit_json), status: prior.status, eligible: false, cached: true, network_requests_performed: false, next_action: "inspect_saved_attempt_do_not_retry_login" };
  return { status: cache?.status === "fetched" ? "legacy_raw_missing" : "not_legacy_projected_cache", eligible: cache?.status === "fetched", raw_response_available: false, source_date: source.date_cn, cached: true, network_requests_performed: false };
}
async function repairActivityRaw(env, ref, transport = nativeFetcher(true)) {
  const before = await readActivityRawRepair(env, ref);
  if (!before.eligible) return before;
  if (env.PERSIST_SYNC_ENABLED !== "true") throw new CollectorError("PERSIST_SYNC_DISABLED");
  if (!env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
  if (Date.now() >= Date.parse("2027-01-01T00:00:00+08:00")) throw new CollectorError("HOSTING_COST_REVIEW_REQUIRED");
  const d = env.DB, lease = "activity_raw_repair_" + crypto.randomUUID(), began = Date.now();
  const lock = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(lease, began + 18e4, began).run();
  if (!lock.meta.changes) throw new CollectorError("SYNC_BUSY_OR_NOT_INITIALIZED");
  const budget = { login_attempts: 1, auth_http_requests: 2, health_requests: 1, retries: 0, elapsed_ms: 45e3 };
  let claimed = false, status = "checking", error = null, auth = 0, health = 0, logins = 0, stored = null;
  const audit = () => ({ status, error_code: error, source_date: before.source_date, endpoint: SPORT_OPERATIONAL_PATH, budget, login_attempts: logins, auth_http_requests: auth, health_requests: health, retries: 0, raw_response_available: !!stored, storage: stored, checkpoints_advanced: false, native_files_requested: false, checked_at: Date.now() });
  try {
    const latest = await readActivityRawRepair(env, ref);
    if (!latest.eligible) return latest;
    const row = await d.prepare("SELECT raw_json FROM raw_records WHERE record_id=? AND metric='sport'").bind(ref).first();
    let raw, payload;
    try {
      raw = JSON.parse(row.raw_json);
      payload = operationalRequest(raw);
      if (typeof raw.sid !== "string" || !raw.sid || typeof raw.key !== "string" || !raw.key || ![payload.start_time, payload.end_time].every((x) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0) || Number(payload.end_time) < Number(payload.start_time)) throw 0;
    } catch {
      throw new CollectorError("REPAIR_SOURCE_NOT_USABLE");
    }
    const claim = await d.prepare("INSERT OR IGNORE INTO activity_raw_repairs(record_ref,status,audit_json,checked_at) VALUES(?,'checking',?,?)").bind(ref, JSON.stringify(audit()), began).run();
    if (!claim.meta.changes) return await readActivityRawRepair(env, ref);
    claimed = true;
    const active = async () => {
      if (!await d.prepare("SELECT 1 AS ok FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?").bind(lease, Date.now()).first()) throw new CollectorError("SYNC_LEASE_LOST");
    };
    const once = async (url, init) => {
      if (Date.now() - began >= budget.elapsed_ms) throw new CollectorError("REPAIR_TIME_LIMIT");
      await active();
      const target = new URL(url), isHealth = target.hostname === "hlth.io.mi.com";
      if (isHealth) {
        if (target.pathname !== SPORT_OPERATIONAL_PATH || health >= 1) throw new CollectorError("REPAIR_REQUEST_LIMIT");
        health++;
      } else {
        if (auth >= 2) throw new CollectorError("REPAIR_REQUEST_LIMIT");
        auth++;
      }
      let r;
      try {
        r = await transport(url, init);
      } catch {
        throw new CollectorError("NETWORK_FAILURE");
      }
      if (r.status !== 200) {
        await r.body?.cancel();
        throw new CollectorError(r.status === 401 || r.status === 403 ? "AUTH_EXPIRED" : r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
      }
      return r;
    };
    const a = new MiFitnessAdapter(once);
    logins++;
    await a.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
    const response = await a.request(SPORT_OPERATIONAL_PATH, payload);
    await active();
    stored = await preserveOperationalResponse(d, ref, response, true);
    status = stored.source_response_empty ? "completed_empty_response" : "completed";
  } catch (e) {
    if (!claimed) throw e;
    status = "failed";
    error = e instanceof CollectorError && errors.has(e.code) ? e.code : "ACTIVITY_RAW_REPAIR_FAILED";
  } finally {
    try {
      if (claimed) await d.prepare("UPDATE activity_raw_repairs SET status=?,audit_json=?,checked_at=? WHERE record_ref=?").bind(status, JSON.stringify(audit()), Date.now(), ref).run();
    } finally {
      await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(lease).run();
    }
  }
  return { ...audit(), eligible: false, cached: false, network_requests_performed: auth + health > 0 };
}

// src/collector/models.ts
var keys = ["steps", "calories", "sleep", "heart_rate", "resting_heart_rate", "sport", "spo2", "stress", "weight", "abnormal_heart_beat", "intensity", "valid_stand", "energy", "goal", "pai", "blood_pressure", "blood_sugar", "headset", "vo2_max", "menstruation", "steps_daily_aggregate"];

// src/data-coverage.ts
init_parser();
init_http();
async function dataCoverage(env, start, end, metric) {
  const window = dateRange(start, end);
  if (window.end - window.start >= 31 * 86400) throw new CollectorError("QUERY_RANGE_TOO_LONG");
  if (metric !== void 0 && !keys.includes(metric)) throw new CollectorError("INVALID_METRIC");
  const metrics = metric ? [metric] : [...keys], args = [start, end, ...metrics], where = "date_cn>=? AND date_cn<=? AND metric IN (" + metrics.map(() => "?").join(",") + ")";
  const cached2 = (await env.DB.prepare("SELECT date_cn,metric,COUNT(*) AS records,SUM(CASE WHEN clean_json IS NULL THEN 1 ELSE 0 END) AS unparsed,MIN(recorded_at) AS first_record_at,MAX(recorded_at) AS latest_record_at,MAX(synced_at) AS last_ingested_at FROM raw_records WHERE " + where + " GROUP BY date_cn,metric").bind(...args).all()).results;
  const logs = (await env.DB.prepare("SELECT l.date_cn,l.metric,l.status,l.error_code,l.record_count,l.at FROM sync_logs l JOIN (SELECT date_cn,metric,MAX(id) AS latest_id FROM sync_logs WHERE " + where + " AND status IN ('page_committed','failed','page_quarantined') GROUP BY date_cn,metric) x ON l.id=x.latest_id").bind(...args).all()).results;
  const dates2 = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates2.push(d);
  const today = dateCN(Math.floor(Date.now() / 1e3)), cmap = new Map(cached2.map((x) => [x.date_cn + "|" + x.metric, x])), lmap = new Map(logs.map((x) => [x.date_cn + "|" + x.metric, x]));
  const rows = dates2.flatMap((date) => metrics.map((metric2) => {
    const c = cmap.get(date + "|" + metric2), l = lmap.get(date + "|" + metric2);
    return { date, metric: metric2, records: c?.records ?? 0, unparsed: c?.unparsed ?? 0, first_record_at: c?.first_record_at ?? null, latest_record_at: c?.latest_record_at ?? null, last_ingested_at: c?.last_ingested_at ?? null, cache_status: c ? "cached_records_present" : "no_cached_records", last_observed_sync_outcome: !l ? "not_checked" : l.status === "page_quarantined" ? "source_records_quarantined" : l.status === "failed" ? "failed" : l.record_count === 0 ? "request_succeeded_empty_page" : "request_succeeded_with_records", last_sync_at: l?.at ?? null, error_code: l?.error_code ?? null, calendar_day_closed: date < today, cloud_upload_complete: "unknown", no_record_reason: c ? null : l?.status === "page_quarantined" ? "source_records_preserved_but_not_indexable" : l?.status === "failed" ? "last_request_failed" : l ? "empty_page_does_not_prove_no_cloud_data" : "no_retained_sync_evidence" };
  }));
  return { start_date: start, end_date: end, metrics, rows, records: cached2.reduce((s, c) => s + c.records, 0), date_semantics: "stored_date_cn_bucket_not_a_guarantee_of_business_date_or_continuous_sampling", cloud_upload_complete: "unknown", today_is_partial: true, today_in_requested_range: start <= today && end >= today, timestamp_units: { first_record_at: "unix_second", latest_record_at: "unix_second", last_ingested_at: "unix_millisecond", last_sync_at: "unix_millisecond" }, record_time_semantics: "outer_source_record_time_not_guaranteed_sample_time", scope: "cached_counts_and_last_retained_page_or_failure_evidence_not_an_upstream_completeness_audit", network_requests_performed: false, timezone: "Asia/Shanghai" };
}

// src/ingestion-quarantine.ts
var sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
async function saveRejectedRecords(d, metric, start, end, rejected, now) {
  const statements = [];
  for (const r of rejected) {
    const clean = redactRawRecord(r.raw), raw = JSON.stringify(clean.value), id = await sha(JSON.stringify([metric, start, end, r.reason, raw]));
    statements.push(d.prepare("INSERT INTO ingestion_quarantine(quarantine_id,metric,requested_start,requested_end,reason_code,index_in_page,raw_json,redactions_json,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(quarantine_id) DO UPDATE SET last_seen_at=excluded.last_seen_at").bind(id, metric, start, end, r.reason, r.index, raw, JSON.stringify(clean.redactions), now, now));
  }
  for (let i = 0; i < statements.length; i += 50) await d.batch(statements.slice(i, i + 50));
}

// src/persistence.ts
init_hrv_source();

// src/workout-analysis.ts
var mean = (v) => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null;
function analyzeHR(input, start, end, source = {}) {
  const groups = /* @__PURE__ */ new Map();
  for (const p of input) {
    if (!Number.isFinite(p.at) || !Number.isFinite(p.bpm) || p.bpm <= 0 || p.bpm > 300) continue;
    const g = groups.get(p.at) ?? /* @__PURE__ */ new Set();
    g.add(p.bpm);
    groups.set(p.at, g);
  }
  const samples = [...groups].filter(([, v]) => v.size === 1).map(([at, v]) => ({ at, bpm: [...v][0] })).sort((a, b) => a.at - b.at), work = samples.filter((p) => p.at >= start && p.at <= end), after = samples.filter((p) => p.at > end && p.at <= end + 300), intervals = work.slice(1).map((p, i) => p.at - work[i].at).sort((a, b) => a - b), median = intervals.length ? intervals[Math.floor(intervals.length / 2)] : null;
  const bins = [{ lower: 0, upper: 100 }, { lower: 100, upper: 120 }, { lower: 120, upper: 140 }, { lower: 140, upper: 160 }, { lower: 160, upper: 180 }, { lower: 180, upper: 301 }].map((b) => ({ ...b, samples: work.filter((p) => p.bpm >= b.lower && p.bpm < b.upper).length }));
  const changes = after.map((p, i) => {
    const prior = i ? after[i - 1] : work.at(-1);
    return { at: p.at, bpm: p.bpm, seconds_after_recorded_workout_end: p.at - end, previous_sample_at: prior?.at ?? null, elapsed_seconds: prior ? p.at - prior.at : null, bpm_change: prior ? p.bpm - prior.bpm : null };
  });
  return { sample_quality: { samples: work.length, conflicting_timestamps_excluded: [...groups.values()].filter((g) => g.size > 1).length, first_sample_at: work[0]?.at ?? null, last_sample_at: work.at(-1)?.at ?? null, first_valid_sample_offset_seconds: work.length ? work[0].at - start : null, last_valid_sample_offset_from_end_seconds: work.length ? end - work.at(-1).at : null, median_interval_seconds: median, max_gap_seconds: intervals.at(-1) ?? null, precision: median !== null && median >= 30 ? "sparse_minute_scale_not_continuous" : "observed_timestamp_resolution", missing_intervals_not_interpolated: true }, observed_heart_rate: { unit: "bpm", kind: "calculated", min: work.length ? Math.min(...work.map((p) => p.bpm)) : null, peak: work.length ? Math.max(...work.map((p) => p.bpm)) : null, mean: mean(work.map((p) => p.bpm)), method: "unique_non_conflicting_observed_samples" }, source_reported_heart_rate: { max: source.max_hrm ?? null, mean: source.avg_hrm ?? null, unit: "bpm", kind: "raw", confidence: "source_reported", note: "Source summary peak may exceed sparse observed peak" }, heart_rate_bands: { unit: "bpm", method: "fixed_absolute_bpm_bins_lower_inclusive_upper_exclusive", personalized_zones: false, bins: bins.map((b) => ({ ...b, sample_fraction: work.length ? b.samples / work.length : null })), duration_seconds: null, warning: "Sample counts are not exact time in zones; no age/max-HR thresholds inferred" }, training_load: { value: source.train_load ?? source.training_load ?? null, unit: null, kind: "raw", confidence: "unverified", source: source.train_load !== void 0 ? "sport.value.train_load" : "sport.value.training_load", meaning: "\u5C0F\u7C73\u6E90\u8BAD\u7EC3\u8D1F\u8377\u6307\u6807\uFF1B\u91CF\u7EB2\u4E0E\u7B97\u6CD5\u672A\u9A8C\u8BC1\uFF0C\u4E0D\u662FTRIMP\u6216\u533B\u5B66\u6307\u6807" }, recovery: { last_workout_observation: work.at(-1) ?? null, post_workout_source: "daily_heart_rate_cache_not_native_workout_file", post_workout_observations: changes, method: "observed_sample_to_sample_changes_after_recorded_end_not_standardized_HRR", post_workout_samples: after.length, standardized_hrr_1min: null, standardized_hrr_2min: null, set_recovery: { supported: false, error_code: "NO_ACTION_TIMESTAMPS", reason: "\u65E0\u52A8\u4F5C\u6216\u6BCF\u7EC4\u8D77\u6B62\u65F6\u95F4\uFF0C\u4E0D\u80FD\u63A8\u6D4B\u7EC4\u95F4\u6062\u590D\u901F\u5EA6" }, warning: "\u8BAD\u7EC3\u7ED3\u675F\u540E\u7684\u6837\u672C\u53D8\u5316\u53D7\u91C7\u6837\u95F4\u9694\u3001\u8FD0\u52A8\u540E\u6D3B\u52A8\u4E0E\u59FF\u52BF\u5F71\u54CD\uFF0C\u4E0D\u4EE3\u8868\u7ECF\u8FC7\u9A8C\u8BC1\u7684\u751F\u7406\u6062\u590D\u901F\u5EA6" }, timestamp_unit: "unix_second" };
}
async function activityHeartRateAnalysis(env, ref) {
  const detail = await activityDetail(env, ref, true, 2e3);
  if (!("summary" in detail) || !detail.summary) return detail;
  const s = detail.summary;
  const extra = (await env.DB.prepare("SELECT recorded_at AS at,json_extract(clean_json,'$.bpm') AS bpm FROM raw_records WHERE metric='heart_rate' AND clean_json IS NOT NULL AND recorded_at>? AND recorded_at<=? ORDER BY recorded_at LIMIT 100").bind(s.end_at, Number(s.end_at) + 300).all()).results;
  const native = await cachedNativeCurve(env, ref, Number(s.start_at), Number(s.end_at)), selected = native.samples.length ? native.samples : detail.heart_rate_samples;
  const analysis = analyzeHR([...selected, ...extra], Number(s.start_at), Number(s.end_at), detail.source_numeric_fields ?? {});
  return { record_ref: ref, series_source: native.samples.length ? "xiaomi_native_workout_fds_format8_v4" : detail.series_source, native_curve: { status: native.status, evidence: native.evidence, quality: native.quality, checked_at: native.checked_at }, ...analysis, source_reported_zone_fields: { values: Object.fromEntries(Object.entries(detail.source_numeric_fields ?? {}).filter(([k]) => /^hrm_.*_duration$|^lower_limit_heartrate_zone_/.test(k))), unit: null, confidence: "unverified", warning: "Source zone units and thresholds are unverified; zero thresholds must not be interpreted as personalized zone boundaries" }, source_summary_comparison: { source_mean_algorithm: "unverified", observed_mean_minus_reported_bpm: analysis.observed_heart_rate.mean !== null && typeof s.avg_heart_rate_bpm === "number" ? Math.round((analysis.observed_heart_rate.mean - s.avg_heart_rate_bpm) * 100) / 100 : null, warning: "Preserve observed and vendor averages independently; do not force a match", observed_peak_matches_reported: analysis.observed_heart_rate.peak !== null && s.max_heart_rate_bpm !== null ? analysis.observed_heart_rate.peak === s.max_heart_rate_bpm : null, rounded_observed_mean_matches_reported: analysis.observed_heart_rate.mean !== null && s.avg_heart_rate_bpm !== null ? Math.round(analysis.observed_heart_rate.mean) === s.avg_heart_rate_bpm : null }, source_field_metadata: detail.source_field_metadata, network_requests_performed: false, timezone: "Asia/Shanghai" };
}
async function activityHeartRateSamples(env, ref, offset = 0, limit = 1e3) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 21600 || !Number.isInteger(limit) || limit < 1 || limit > 2e3) throw new Error("INVALID_SAMPLE_RANGE");
  const detail = await activityDetail(env, ref, true, 2e3);
  if (!("summary" in detail) || !detail.summary) return detail;
  const native = await cachedNativeCurve(env, ref, Number(detail.summary.start_at), Number(detail.summary.end_at));
  const points = native.samples.length ? native.samples : detail.heart_rate_samples;
  return { record_ref: ref, series_source: native.samples.length ? "xiaomi_native_workout_fds_format8_v4" : detail.series_source, samples: points.slice(offset, offset + limit), total_samples: points.length, next_offset: offset + limit < points.length ? offset + limit : null, quality: native.quality, native_status: native.status, timestamp_unit: "unix_second", heart_rate_unit: "bpm", network_requests_performed: false };
}

// src/mcp-sync.ts
init_parser();
init_http();

// src/workout-native.ts
init_http();
init_parser();
var endpoint = NATIVE_FILE_PATH;
var url64 = (v) => b64(v).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeURL64(s) {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s) || s.replace(/=+$/, "").length % 4 === 1) throw new CollectorError("FDS_BASE64_INVALID");
  const core = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  return unb64(core + "=".repeat((4 - core.length % 4) % 4));
}
async function fdsSuffix(sid, timestamp, tz, proto) {
  if (!sid || !Number.isInteger(timestamp) || timestamp < 0 || timestamp > 4294967295 || !Number.isInteger(tz) || tz < -128 || tz > 127 || !Number.isInteger(proto) || proto < 0 || proto > 31) throw new CollectorError("FDS_REFERENCE_INVALID");
  const b = new Uint8Array(6), v = new DataView(b.buffer);
  v.setUint32(0, timestamp, true);
  v.setInt8(4, tz);
  b[5] = 128 + (proto << 2) & 255;
  return url64(b) + "_" + url64(await digest("SHA-1", utf8(sid)));
}
function allowedFDS(raw) {
  if (/[^\x21-\x7e]|\\/.test(raw)) throw new CollectorError("FDS_HOST_BLOCKED");
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new CollectorError("FDS_HOST_BLOCKED");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.port && u.port !== "443" || !u.hostname.endsWith(".fds.api.xiaomi.com") || !/^(?:[a-z0-9-]{1,63}\.)+[a-z0-9-]{1,63}$/.test(u.hostname)) throw new CollectorError("FDS_HOST_BLOCKED");
  return u;
}
async function decryptFDS(body, key) {
  try {
    const v = body.trim(), encoded = v.startsWith('"') ? JSON.parse(v) : v;
    if (typeof encoded !== "string") throw 0;
    const k = decodeURL64(key), ct = decodeURL64(encoded);
    if (![16, 24, 32].includes(k.length) || !ct.length || ct.length % 16) throw 0;
    const secret = await crypto.subtle.importKey("raw", new Uint8Array(k), "AES-CBC", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: utf8("1234567887654321") }, secret, new Uint8Array(ct)));
  } catch {
    throw new CollectorError("FDS_DECRYPT_FAILED");
  }
}
var errors2 = /* @__PURE__ */ new Set(["AUTH_REQUIRED", "AUTH_EXPIRED", "LOGIN_REJECTED", "INTERACTIVE_AUTH_REQUIRED", "LOGIN_HTTP_ERROR", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "NETWORK_FAILURE", "UPSTREAM_RATE_LIMITED", "UPSTREAM_HTTP_ERROR", "UPSTREAM_BUSINESS_ERROR", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "SYNC_LEASE_LOST", "NATIVE_TIME_LIMIT", "NATIVE_REQUEST_LIMIT", "NATIVE_SOURCE_NOT_USABLE", "FDS_HOST_BLOCKED", "FDS_METHOD_BLOCKED", "FDS_DECRYPT_FAILED", "FDS_HEADER_INVALID", "FDS_HEADER_MISMATCH", "FDS_DOWNLOAD_HTTP_ERROR"]);
var errorCode = (e) => e instanceof CollectorError && errors2.has(e.code) ? e.code : "NATIVE_FILE_FETCH_FAILED";
async function activeLease(env, lease) {
  if (!await env.DB.prepare("SELECT 1 AS ok FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?").bind(lease, Date.now()).first()) throw new CollectorError("SYNC_LEASE_LOST");
}
async function cached(env, ref) {
  const old = await env.DB.prepare("SELECT status,evidence_json,checked_at FROM workout_native_cache WHERE record_ref=?").bind(ref).first();
  return old ? { status: old.status, evidence: JSON.parse(old.evidence_json), checked_at: old.checked_at, cached: true } : null;
}
async function collectNativeWorkout(env, ref, lease, deadline, lookup, download, evidence) {
  const d = env.DB, old = await cached(env, ref);
  if (old) return old;
  const row = await d.prepare("SELECT raw_json FROM raw_records WHERE metric='sport' AND record_id=?").bind(ref).first();
  if (!row) return { status: "not_found", cached: true };
  await activeLease(env, lease);
  const claim = await d.prepare("INSERT OR IGNORE INTO workout_native_cache(record_ref,status,evidence_json,checked_at) VALUES(?,'checking',?,?)").bind(ref, JSON.stringify(evidence), Date.now()).run();
  if (!claim.meta.changes) return await cached(env, ref);
  let status = "failed", payload = null;
  const permit = async () => {
    await activeLease(env, lease);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CollectorError("NATIVE_TIME_LIMIT");
    return AbortSignal.timeout(Math.min(2e4, remaining));
  };
  try {
    let r, timestamp, tz, proto, suffix;
    try {
      r = JSON.parse(row.raw_json);
      const p = value(r);
      if (typeof p.time !== "number" || typeof p.timezone !== "number" || typeof p.proto_type !== "number") throw 0;
      timestamp = p.time;
      tz = p.timezone;
      proto = p.proto_type;
      suffix = await fdsSuffix(r.sid ?? "", timestamp, tz, proto);
    } catch {
      status = "schema_unverified";
      throw new CollectorError("NATIVE_SOURCE_NOT_USABLE");
    }
    evidence.proto_type = proto;
    const map = await lookup({ did: r.sid, items: [{ timestamp, suffix }] }, await permit());
    evidence.http_status = 200;
    evidence.business_code = 0;
    const entry = map[suffix + "_" + timestamp];
    evidence.entry_present = !!entry;
    evidence.key_present = typeof entry?.obj_key === "string" && !!entry.obj_key;
    if (typeof entry?.url !== "string" || typeof entry.obj_key !== "string" || !entry.obj_key) {
      status = "not_stored_at_check";
      evidence.error_code = "FDS_NO_STORED_FILE";
    } else {
      if (entry.method && entry.method !== "GET") throw new CollectorError("FDS_METHOD_BLOCKED");
      const target = allowedFDS(entry.url), signal = await permit();
      evidence.download_requests = 1;
      let file;
      try {
        file = await download(target.href, { method: "GET", credentials: "omit", redirect: "manual", signal });
      } catch {
        throw new CollectorError("NETWORK_FAILURE");
      }
      evidence.download_http_status = file.status;
      if (file.status !== 200) {
        await file.body?.cancel();
        throw new CollectorError(file.status === 401 || file.status === 403 ? "AUTH_EXPIRED" : file.status === 429 ? "UPSTREAM_RATE_LIMITED" : "FDS_DOWNLOAD_HTTP_ERROR");
      }
      const body = await boundedText(file, 2 * 1024 * 1024), plain = await decryptFDS(body, entry.obj_key);
      if (plain.length < 8) throw new CollectorError("FDS_HEADER_INVALID");
      const v = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
      if (v.getUint32(0, true) !== timestamp || v.getInt8(4) !== tz || plain[6] !== proto) throw new CollectorError("FDS_HEADER_MISMATCH");
      evidence.header = { version: plain[5], proto_type: plain[6], storage_mode: plain[7], bytes: plain.length };
      status = "downloaded_decoder_unverified";
      evidence.error_code = "NATIVE_FORMAT_DECODER_NOT_VERIFIED";
      payload = b64(plain);
    }
    await activeLease(env, lease);
  } catch (e) {
    if (status !== "schema_unverified") status = "failed";
    payload = null;
    evidence.error_code = errorCode(e);
  }
  const at = Date.now();
  await d.prepare("UPDATE workout_native_cache SET status=?,evidence_json=?,payload_base64=?,checked_at=? WHERE record_ref=?").bind(status, JSON.stringify(evidence), payload, at, ref).run();
  return { status, evidence, checked_at: at, cached: false };
}
async function nativeSyncState(env, start, end) {
  const rows = (await env.DB.prepare(`SELECT CASE WHEN n.record_ref IS NULL THEN 'pending' WHEN n.payload_base64 IS NOT NULL THEN 'stored' ELSE n.status END AS state,COUNT(*) AS count FROM raw_records r LEFT JOIN workout_native_cache n ON n.record_ref=r.record_id WHERE r.metric='sport' AND r.date_cn>=? AND r.date_cn<=? GROUP BY state`).bind(start, end).all()).results;
  const count = (state) => rows.find((r) => r.state === state)?.count ?? 0, pending = count("pending");
  return { scope: { start_date: start, end_date: end, timezone: "Asia/Shanghai" }, pending, stored: count("stored"), not_stored_at_check: count("not_stored_at_check"), failed: count("failed"), checking: count("checking"), schema_unverified: count("schema_unverified"), max_files_per_batch: 1, max_reference_requests_per_batch: 1, max_download_requests_per_batch: 1, automatic_retry: false, upstream_upload_complete: "unknown", next_action: pending ? "continue_trigger_sync" : count("failed") || count("checking") ? "inspect_saved_attempt_do_not_retry_login" : "read_cached_activity" };
}
async function fetchPendingNativeWorkout(env, adapter, lease, start, end, deadline, download = fetch) {
  if (Date.now() >= deadline) return { status: "deferred_time_budget", cached: true };
  const row = await env.DB.prepare("SELECT r.record_id FROM raw_records r LEFT JOIN workout_native_cache n ON n.record_ref=r.record_id WHERE r.metric='sport' AND r.date_cn>=? AND r.date_cn<=? AND n.record_ref IS NULL ORDER BY r.recorded_at DESC,r.record_id LIMIT 1").bind(start, end).first();
  if (!row) return { status: "no_pending_native_files", cached: true };
  const evidence = { endpoint, method: "GET", signature_path: "/service/gen_download_url", requested_file_type: 0, session_source: "current_sync", login_attempts: 0, reference_requests: 0, download_requests: 0, max_reference_requests: 1, max_download_requests: 1, retries: 0, gps_requested: false };
  const result = await collectNativeWorkout(env, row.record_id, lease, deadline, (payload, signal) => {
    evidence.reference_requests = 1;
    return adapter.nativeFileReference(payload, signal);
  }, download, evidence);
  if (result.status === "failed") throw new CollectorError("NATIVE_FILE_FETCH_FAILED");
  return result;
}
async function probeNativeWorkout(env, ref, transport = nativeFetcher(true), download = fetch) {
  if (!env.DB) throw new CollectorError("DATABASE_NOT_READY");
  if (!/^[A-Za-z0-9+/_=-]{8,100}$/.test(ref)) throw new CollectorError("INVALID_DETAIL_QUERY");
  const old = await cached(env, ref);
  if (old) return old;
  if (env.PERSIST_SYNC_ENABLED !== "true") throw new CollectorError("PERSIST_SYNC_DISABLED");
  if (!env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
  if (Date.now() >= Date.parse("2027-01-01T00:00:00+08:00")) throw new CollectorError("HOSTING_COST_REVIEW_REQUIRED");
  const d = env.DB, lease = "native_file_" + crypto.randomUUID(), began = Date.now(), deadline = began + 45e3;
  const claim = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(lease, began + 18e4, began).run();
  if (!claim.meta.changes) return { status: "busy", error_code: "SYNC_BUSY" };
  const evidence = { endpoint, method: "GET", signature_path: "/service/gen_download_url", requested_file_type: 0, session_source: "selected_record_operator", login_attempts: 0, auth_http_requests: 0, reference_requests: 0, download_requests: 0, budget: { login_attempts: 1, auth_http_requests: 2, reference_requests: 1, download_requests: 1, elapsed_ms: 45e3 }, retries: 0, gps_requested: false };
  const once = async (url, init) => {
    await activeLease(env, lease);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new CollectorError("NATIVE_TIME_LIMIT");
    const target = new URL(url), health = target.hostname === "hlth.io.mi.com", counter = health ? "reference_requests" : "auth_http_requests";
    if (health && target.pathname !== endpoint || Number(evidence[counter]) >= (health ? 1 : 2)) throw new CollectorError("NATIVE_REQUEST_LIMIT");
    evidence[counter] = Number(evidence[counter]) + 1;
    let r;
    try {
      r = await transport(url, { ...init, signal: AbortSignal.timeout(Math.min(2e4, remaining)) });
    } catch {
      throw new CollectorError("NETWORK_FAILURE");
    }
    if (r.status !== 200) {
      await r.body?.cancel();
      throw new CollectorError(r.status === 401 || r.status === 403 ? "AUTH_EXPIRED" : r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
    }
    return r;
  };
  try {
    const adapter = new MiFitnessAdapter(once);
    return await collectNativeWorkout(env, ref, lease, deadline, async (payload, signal) => {
      evidence.login_attempts = 1;
      await adapter.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
      return adapter.nativeFileReference(payload, signal);
    }, download, evidence);
  } finally {
    await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(lease).run();
  }
}

// src/mcp-sync.ts
function validateId(id) {
  if (id !== void 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new CollectorError("INVALID_SYNC_ID");
}
async function getSyncProgress(env, id, now = Date.now()) {
  validateId(id);
  if (!env.DB) return { status: "failed", complete: false, error_code: "DATABASE_NOT_READY", next_action: "stop" };
  const d = env.DB, j = await d.prepare("SELECT * FROM sync_jobs WHERE id=1").first();
  if (!j) return { status: "not_started", sync_id: null, complete: false, next_action: "call_trigger_sync" };
  if (id && j.run_id !== id) return { status: "superseded", sync_id: id, current_sync_id: j.run_id, complete: false, next_action: "inspect_current_sync_do_not_restart_blindly" };
  const attempts = (await d.prepare(`SELECT metric,date_cn,status,at,error_code,received,quarantined FROM (SELECT metric,date_cn,status,at,error_code,SUM(CASE WHEN status='page_committed' THEN record_count ELSE 0 END) OVER(PARTITION BY metric,date_cn) AS received,SUM(CASE WHEN status='page_quarantined' THEN record_count ELSE 0 END) OVER(PARTITION BY metric,date_cn) AS quarantined,ROW_NUMBER() OVER(PARTITION BY metric,date_cn ORDER BY id DESC) AS n FROM sync_logs WHERE metric IS NOT NULL AND date_cn>=? AND date_cn<=? AND at>=?) WHERE n=1`).bind(j.start_date, j.end_date, j.run_started_at ?? 0).all()).results;
  const coverage = (await d.prepare("SELECT metric,date_cn,COUNT(*) AS records,MAX(recorded_at) AS latest_record_at,MAX(synced_at) AS latest_synced_at FROM raw_records WHERE date_cn>=? AND date_cn<=? GROUP BY metric,date_cn").bind(j.start_date, j.end_date).all()).results;
  const dates2 = j.start_date === j.end_date ? [j.end_date] : [j.end_date, j.start_date];
  const metrics = dates2.flatMap((date) => keys.map((metric, i) => {
    const a = attempts.find((x) => x.metric === metric && x.date_cn === date), c = coverage.find((x) => x.metric === metric && x.date_cn === date), done = !!j.complete || date > j.current_date || date === j.current_date && i < j.metric_index, state = a?.status === "failed" ? "failed" : done && a?.quarantined ? "partial_data" : done ? a ? a.received > 0 ? "success" : "no_records" : c?.records ? "success" : "no_records" : date === j.current_date && i === j.metric_index ? "in_progress" : "pending";
    return { date, metric, status: state, records: c?.records ?? 0, records_received: a?.received ?? null, quarantined_observations: a?.quarantined ?? 0, source_quality: a?.quarantined ? "partial_source_records_quarantined" : "no_quarantine_in_retained_run_logs", latest_record_at: c?.latest_record_at ?? null, latest_synced_at: c?.latest_synced_at ?? null, last_attempt_at: a?.at ?? null, error_code: a?.error_code ?? (a?.quarantined ? "SOURCE_RECORDS_QUARANTINED" : null), freshness: freshness(["heart_rate", "spo2", "stress", "steps", "resting_heart_rate"].includes(metric) ? c?.latest_record_at ?? null : null, date, dateCN(Math.floor(now / 1e3)), now), upload_state: "unknown", empty_result_reason: state === "no_records" ? "EMPTY_RESPONSE_UPLOAD_STATE_UNKNOWN" : null, upload_pending_possible: state === "no_records", latest_sample_at: ["heart_rate", "spo2", "stress", "steps", "resting_heart_rate"].includes(metric) ? c?.latest_record_at ?? null : null, sample_age_seconds: ["heart_rate", "spo2", "stress", "steps", "resting_heart_rate"].includes(metric) && c ? Math.max(0, Math.floor(now / 1e3) - c.latest_record_at) : null };
  }));
  const failures = metrics.filter((m) => m.status === "failed" || m.status === "partial_data"), success = metrics.filter((m) => ["success", "no_records"].includes(m.status));
  const nativeFiles = await nativeSyncState(env, j.start_date, j.end_date);
  const status = j.run_error_code ? "failed" : j.lease_until > now ? "running" : j.complete ? nativeFiles.pending ? "partial" : failures.length || nativeFiles.failed || nativeFiles.checking || nativeFiles.schema_unverified ? "completed_with_errors" : "completed" : "partial";
  return { task_completed_at: j.complete && !nativeFiles.pending ? j.updated_at : null, task_age_seconds: j.complete && !nativeFiles.pending ? Math.max(0, Math.floor((now - j.updated_at) / 1e3)) : null, freshness_note: "Task completion and ingestion do not establish sample freshness or upstream upload completeness. Empty success is not proof of no activity or missing upload.", timestamp_units: { task_completed_at: "unix_millisecond", latest_sample_at: "unix_second", sample_age_seconds: "second", task_age_seconds: "second", latest_data_at: "unix_second", latest_record_at: "unix_second", latest_synced_at: "unix_millisecond", updated_at: "unix_millisecond", started_at: "unix_millisecond" }, sync_id: j.run_id, status, complete: !!j.complete && !nativeFiles.pending && !["failed", "running"].includes(status), metrics_complete: !!j.complete, native_files: nativeFiles, scope: { start_date: j.start_date, end_date: j.end_date, timezone: "Asia/Shanghai", history_included: false }, progress: { completed_metric_days: success.length + failures.length, total_metric_days: keys.length * dates2.length, percent: Math.round((success.length + failures.length) / (keys.length * dates2.length) * 100), current_date: j.complete ? null : j.current_date, current_metric: j.complete ? null : keys[j.metric_index] }, successful_metrics: success, failed_metrics: failures, pending_metrics: metrics.filter((m) => ["pending", "in_progress"].includes(m.status)), latest_data_at: coverage.length ? Math.max(...coverage.map((x) => x.latest_record_at)) : null, updated_at: j.updated_at, started_at: j.run_started_at, error_code: j.run_error_code, next_action: status === "partial" ? "call_trigger_sync_with_same_sync_id" : status === "running" ? "wait_then_get_sync_progress" : status === "failed" ? "stop_and_resolve_error_before_an_explicit_retry" : "read_daily_summary", continuation_required: status === "partial", poll_after_seconds: status === "running" ? 5 : 0, today: dateCN(Math.floor(now / 1e3)), today_is_partial: true, upstream_upload_complete: "unknown", historical_checkpoint_unchanged: true };
}
async function triggerSync(env, id, transport = nativeFetcher(true), now = Date.now(), retryFailed = false) {
  validateId(id);
  if (!env.DB) return { status: "failed", complete: false, error_code: "DATABASE_NOT_READY", next_action: "stop" };
  let j = await env.DB.prepare("SELECT * FROM sync_jobs WHERE id=1").first();
  if (id && j?.run_id !== id) return getSyncProgress(env, id, now);
  if (id && j?.complete && !j.run_error_code) {
    const p = await getSyncProgress(env, id, now);
    if (p.complete) return { ...p, reused_recent_result: true, data_analysis_allowed: true };
  }
  if (id && j && j.end_date < dateCN(Math.floor(now / 1e3))) return { status: "superseded", sync_id: id, complete: false, next_action: "call_trigger_sync_without_id_for_today" };
  if (j?.lease_until && j.lease_until > now) {
    const p = await getSyncProgress(env, id, now);
    return { ...p, status: j.complete ? "busy" : p.status, complete: false, requested_sync_started: !j.complete, next_action: j.complete ? "wait_then_retry_trigger_sync_without_id" : "wait_then_get_sync_progress", poll_after_seconds: 5 };
  }
  if (j?.run_error_code) {
    if (!retryFailed) return getSyncProgress(env, id, now);
    await env.DB.prepare("UPDATE sync_jobs SET run_error_code=NULL WHERE id=1 AND lease_until<=?").bind(now).run();
  }
  try {
    const b = await runPersistentSync(env, transport, now, { liveOnly: true, refreshAfterMs: 12e4, maxPages: 8, budgetMs: 18e3 });
    const p = await getSyncProgress(env, id, Date.now());
    return { ...p, reused_recent_result: b.status === "already_current", batch: { pages: "pages" in b ? b.pages : 0, records_processed: "recordsProcessed" in b ? b.recordsProcessed : 0, native_file_status: "native_file_batch" in b ? b.native_file_batch?.status : null }, data_analysis_allowed: !!p.complete };
  } catch (e) {
    const code = syncErrorCode(e);
    if (code === "SYNC_BUSY") return { ...await getSyncProgress(env, id), status: "busy", complete: false, next_action: "wait_then_get_sync_progress", poll_after_seconds: 5 };
    return { ...await getSyncProgress(env, id), status: "failed", complete: false, error_code: code, next_action: "stop_do_not_retry_login_automatically", data_analysis_allowed: false };
  }
}

// src/persistence.ts
init_step_audit();
init_http();
init_parser();
var hash = async (v) => b64(await digest("SHA-256", utf8(v)));
function stripCredentials(v) {
  if (typeof v === "string" && /^[\[{]/.test(v.trim())) {
    try {
      return JSON.stringify(stripCredentials(JSON.parse(v)));
    } catch {
      return v;
    }
  }
  if (Array.isArray(v)) return v.map(stripCredentials);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (/token|cookie|password|ssecurity|authorization|userid|cuserid/i.test(k.replace(/[_-]/g, ""))) continue;
      o[k] = stripCredentials(x);
    }
    return o;
  }
  return v;
}
function db(env) {
  if (!env.DB) throw new CollectorError("DATABASE_NOT_READY");
  return env.DB;
}
async function log(d, status, metric, date, count = 0, error = null) {
  await d.prepare("INSERT INTO sync_logs(at,status,metric,date_cn,record_count,error_code) VALUES(?,?,?,?,?,?)").bind(Date.now(), status, metric, date, count, error).run();
}
var safeErrors = /* @__PURE__ */ new Set(["AUTH_EXPIRED", "LOGIN_REJECTED", "INTERACTIVE_AUTH_REQUIRED", "LOGIN_HTTP_ERROR", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "UPSTREAM_BUSINESS_ERROR", "UPSTREAM_HTTP_ERROR", "UPSTREAM_RATE_LIMITED", "UPSTREAM_RETRY_DEFERRED", "UPSTREAM_RETRY_EXHAUSTED", "NETWORK_FAILURE", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "CURSOR_LOOP", "INVALID_PAGE", "INVALID_CURSOR", "INVALID_HAS_MORE", "CURSOR_MISSING", "PAGE_RECORD_LIMIT", "NATIVE_FILE_FETCH_FAILED"]);
var syncErrorCode = (e) => e instanceof CollectorError && ["PERSIST_SYNC_DISABLED", "DATABASE_NOT_READY", "SECRETS_NOT_CONFIGURED", "HOSTING_COST_REVIEW_REQUIRED", "SYNC_BUSY", "SYNC_LEASE_LOST", "SYNC_STATE_INVALID", "SECRETS_NOT_CONFIGURED"].includes(e.code) ? e.code : safeError(e);
var safeError = (e) => e instanceof CollectorError && safeErrors.has(e.code) ? e.code : "SYNC_FAILED";
function cleaned(key, r) {
  const p = value(r);
  if (key === "steps" && (!Number.isSafeInteger(p.steps) || Number(p.steps) < 0)) throw 0;
  if (key === "calories" && typeof p.calories !== "number") throw 0;
  if ((key === "heart_rate" || key === "resting_heart_rate") && (!(typeof p.bpm === "number") || p.bpm <= 0 || p.bpm > 300)) throw 0;
  if (key === "sleep" && !(p.bedtime || p.device_bedtime || p.bed_timestamp) && !p.duration) throw 0;
  return parseRecord(key, r).data;
}
async function saveRecords(d, key, records, now) {
  const statements = [];
  for (const offset of Array.from({ length: Math.ceil(records.length / 50) }, (_, i) => i * 50)) {
    const prepared = await Promise.all(records.slice(offset, offset + 50).map(async (r) => {
      const json = JSON.stringify(stripCredentials(r));
      const [sid, h] = await Promise.all([hash(r.sid ?? "unknown"), hash(json)]);
      return { r, json, sid, h, id: await hash(JSON.stringify([key, sid, r.key ?? key, r.time])) };
    }));
    for (const { r, json, sid, h, id } of prepared) {
      let clean = null;
      try {
        clean = JSON.stringify(cleaned(key, r));
      } catch {
      }
      const date = dateCN(r.time);
      statements.push(d.prepare("INSERT INTO raw_versions(record_id,payload_hash,raw_json,synced_at) VALUES(?,?,?,?) ON CONFLICT(record_id,payload_hash) DO NOTHING").bind(id, h, json, now));
      statements.push(d.prepare(`INSERT INTO raw_records(record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET raw_json=excluded.raw_json,clean_json=excluded.clean_json,parse_status=excluded.parse_status,synced_at=excluded.synced_at`).bind(id, key, r.time, date, sid, json, clean, clean ? "parsed" : "schema_unverified", now));
    }
  }
  for (let i = 0; i < statements.length; i += 50) await d.batch(statements.slice(i, i + 50));
}
async function summarize(d, date, now) {
  const r = await buildDaily({ DB: d }, date), s = r.summary;
  await d.prepare(`INSERT INTO daily_summary(date_cn,steps,steps_sample_sum,steps_record_count,step_semantics,resting_hr,sleep_minutes,active_kcal,exercise_minutes,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date_cn) DO UPDATE SET steps=excluded.steps,steps_sample_sum=excluded.steps_sample_sum,steps_record_count=excluded.steps_record_count,step_semantics=excluded.step_semantics,resting_hr=excluded.resting_hr,sleep_minutes=excluded.sleep_minutes,active_kcal=excluded.active_kcal,exercise_minutes=excluded.exercise_minutes,synced_at=excluded.synced_at`).bind(date, s.steps, s.steps_sample_sum, s.steps_record_count, s.step_semantics, s.resting_hr, s.sleep_minutes, s.active_kcal, s.exercise_minutes, s.synced_at ?? now).run();
}
async function runPersistentSync(env, transport = nativeFetcher(true), now = Date.now(), options = {}) {
  if (env.PERSIST_SYNC_ENABLED !== "true") throw new CollectorError("PERSIST_SYNC_DISABLED");
  if (now >= Date.parse("2027-01-01T00:00:00+08:00")) throw new CollectorError("HOSTING_COST_REVIEW_REQUIRED");
  const d = db(env), today = dateCN(Math.floor(now / 1e3)), token2 = crypto.randomUUID();
  let live = await d.prepare("SELECT * FROM sync_jobs WHERE id=1").first();
  const pendingNative = live ? (await nativeSyncState(env, live.start_date, live.end_date)).pending : 0;
  if (!live || live.end_date < today || live.complete && !pendingNative && now - live.updated_at >= (options.refreshAfterMs ?? 20 * 6e4)) {
    const start = addDays(today, -1);
    await d.prepare(`INSERT INTO sync_jobs(id,start_date,end_date,metric_index,current_date,cursor,complete,lease_until,updated_at,run_id,run_started_at,run_error_code) VALUES(1,?,?,0,?,NULL,0,0,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET start_date=excluded.start_date,end_date=excluded.end_date,metric_index=0,current_date=excluded.current_date,cursor=NULL,seen_json='[]',complete=0,updated_at=excluded.updated_at,run_id=excluded.run_id,run_started_at=excluded.run_started_at,run_error_code=NULL WHERE sync_jobs.lease_until<=?`).bind(start, today, today, now, crypto.randomUUID(), Date.now(), Date.now()).run();
  }
  const oldest = addDays(today, -364), histEnd = addDays(today, -2);
  if (!options.liveOnly) await d.prepare("INSERT OR IGNORE INTO sync_history(id,start_date,end_date,metric_index,current_date,updated_at) VALUES(1,?,?,0,?,?)").bind(oldest, histEnd, histEnd, now).run();
  const acquired = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(token2, Date.now() + 18e4, Date.now()).run();
  if (!acquired.meta.changes) throw new CollectorError("SYNC_BUSY");
  let processed = 0, pages = 0, failures = 0, quarantined = 0;
  const touched = /* @__PURE__ */ new Set();
  try {
    if (!env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
    live = await d.prepare("SELECT * FROM sync_jobs WHERE id=1").first();
    if (options.liveOnly && live.complete && !pendingNative) return { status: "already_current", liveThrough: live.end_date, liveComplete: true };
    if (options.liveOnly && live.run_error_code) throw new CollectorError(live.run_error_code);
    if (!live.run_id) {
      await d.prepare("UPDATE sync_jobs SET run_id=?,run_started_at=? WHERE id=1 AND run_id IS NULL AND lease_token=?").bind(crypto.randomUUID(), Date.now(), token2).run();
      live = await d.prepare("SELECT * FROM sync_jobs WHERE id=1").first();
    }
    const plan = options.liveOnly || !live.complete ? "live" : "history", table = plan === "live" ? "sync_jobs" : "sync_history";
    let job = plan === "live" ? live : await d.prepare("SELECT * FROM sync_history WHERE id=1").first();
    if (job.complete && !pendingNative) return { status: "already_current", liveThrough: live.end_date, historyComplete: plan === "history" };
    const adapter = new MiFitnessAdapter(transport, void 0, void 0, { totalWaitMs: 1500, maxWaitMs: 1e3 });
    await adapter.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
    const started = Date.now();
    if (!job.complete) await fetchActivityDetails(env, adapter, ...options.liveOnly ? [live.start_date, live.end_date] : []);
    while (pages < (options.maxPages ?? 12) && !job.complete && Date.now() - started < (options.budgetMs ?? 45e3)) {
      const key = keys[job.metric_index];
      if (!key) throw new CollectorError("SYNC_STATE_INVALID");
      let page;
      try {
        page = await adapter.page(key, job.current_date, job.current_date, job.cursor);
      } catch (e) {
        const code = safeError(e);
        await log(d, "failed", key, job.current_date, 0, code);
        await capability(d, key, "error", 0, code);
        if (["AUTH_EXPIRED", "INTERACTIVE_AUTH_REQUIRED", "UPSTREAM_HTTP_ERROR", "UPSTREAM_RATE_LIMITED", "UPSTREAM_BUSINESS_ERROR", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "UPSTREAM_RETRY_DEFERRED", "NETWORK_FAILURE", "UPSTREAM_RETRY_EXHAUSTED", "PAGE_RECORD_LIMIT"].includes(code)) throw e;
        failures++;
        advance(job);
        await checkpoint(d, job, token2, table);
        pages++;
        continue;
      }
      const seen = JSON.parse(job.seen_json);
      if (page.hasMore && (!page.nextKey || page.nextKey === job.cursor || seen.includes(page.nextKey) || seen.length >= 100)) throw new CollectorError("CURSOR_LOOP");
      await saveRecords(d, key, page.records, Date.now());
      if (page.rejected?.length) await saveRejectedRecords(d, key, job.current_date, job.current_date, page.rejected, Date.now());
      touched.add(job.current_date);
      processed += page.records.length;
      pages++;
      await log(d, "page_committed", key, job.current_date, page.records.length);
      if (page.rejected?.length) {
        quarantined += page.rejected.length;
        await log(d, "page_quarantined", key, job.current_date, page.rejected.length, "SOURCE_RECORDS_QUARANTINED");
      }
      await capability(d, key, page.records.length ? "data_returned" : "no_records_in_range", page.records.length, null);
      if (page.hasMore) {
        job.cursor = page.nextKey;
        job.seen_json = JSON.stringify([...seen, page.nextKey]);
      } else advance(job);
      await checkpoint(d, job, token2, table);
    }
    for (const date of touched) await summarize(d, date, Date.now());
    const nativeFile = await fetchPendingNativeWorkout(env, adapter, token2, live.start_date, live.end_date, started + (options.budgetMs ?? 45e3), options.nativeDownload);
    const nativeFiles = await nativeSyncState(env, live.start_date, live.end_date);
    const latest = await d.prepare("SELECT complete,end_date FROM sync_jobs WHERE id=1").first();
    const hist = await d.prepare("SELECT complete FROM sync_history WHERE id=1").first();
    return { status: latest?.complete && hist?.complete && !nativeFiles.pending ? "complete" : "partial", plan, pages, recordsProcessed: processed, failedPages: failures, quarantinedRecords: quarantined, data_quality: quarantined ? "partial_source_records_quarantined" : "no_new_quarantined_records", startDate: job.start_date, endDate: job.end_date, liveThrough: latest?.end_date, liveComplete: !!latest?.complete, historyComplete: !!hist?.complete, native_file_batch: nativeFile, native_files: nativeFiles, nextMetric: job.complete ? null : keys[job.metric_index], nextDate: job.complete ? null : job.current_date, todayIsPartial: true };
  } catch (e) {
    const code = syncErrorCode(e);
    await log(d, "failed", null, null, 0, code);
    if (options.liveOnly) await d.prepare("UPDATE sync_jobs SET run_error_code=?,updated_at=? WHERE id=1 AND lease_token=?").bind(code, Date.now(), token2).run();
    throw e;
  } finally {
    await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(token2).run();
  }
}
function advance(j) {
  j.cursor = null;
  j.seen_json = "[]";
  j.metric_index++;
  if (j.metric_index >= keys.length) {
    j.metric_index = 0;
    if (j.current_date > j.start_date) j.current_date = addDays(j.current_date, -1);
    else j.complete = 1;
  }
}
async function capability(d, key, status, count, error) {
  await d.prepare("INSERT INTO metric_capabilities(metric,last_checked,status,last_count,error_code) VALUES(?,?,?,?,?) ON CONFLICT(metric) DO UPDATE SET last_checked=excluded.last_checked,status=excluded.status,last_count=excluded.last_count,error_code=excluded.error_code").bind(key, Date.now(), status, count, error).run();
}
async function checkpoint(d, j, token2, table = "sync_jobs") {
  const r = await d.prepare(`UPDATE ${table} SET metric_index=?,current_date=?,cursor=?,seen_json=?,complete=?,updated_at=? WHERE id=1 AND EXISTS(SELECT 1 FROM sync_jobs WHERE id=1 AND lease_token=? AND lease_until>?)`).bind(j.metric_index, j.current_date, j.cursor, j.seen_json, j.complete, Date.now(), token2, Date.now()).run();
  if (!r.meta.changes) throw new CollectorError("SYNC_LEASE_LOST");
  await d.prepare("UPDATE sync_jobs SET lease_until=? WHERE id=1 AND lease_token=?").bind(Date.now() + 18e4, token2).run();
}
function validRange(start, end, max = 90) {
  if (typeof start !== "string" || typeof end !== "string") throw new CollectorError("DATE_PARAMETERS_REQUIRED");
  const r = dateRange(start, end);
  if (r.end - r.start >= max * 86400) throw new CollectorError("QUERY_RANGE_TOO_LONG");
  return { start, end };
}
var metricInfo = { steps_daily_aggregate: { label: "\u4E91\u7AEF\u65E5\u6B65\u6570\u805A\u5408", unit: "\u6B65\uFF08\u5F85\u5BF9\u7167\uFF09", field: "value" }, steps: { label: "\u6B65\u6570", unit: "\u6B65", field: "steps" }, calories: { label: "\u6D3B\u52A8\u6D88\u8017", unit: "kcal\uFF08\u91C7\u6837\u503C\uFF09", field: "active_kcal" }, sleep: { label: "\u7761\u7720", unit: "\u5206\u949F", field: "duration_minutes" }, heart_rate: { label: "\u5168\u5929\u5FC3\u7387", unit: "bpm", field: "bpm" }, resting_heart_rate: { label: "\u9759\u606F\u5FC3\u7387", unit: "bpm", field: "bpm" }, sport: { label: "\u8FD0\u52A8", unit: "\u5206\u949F", field: "duration_minutes" }, spo2: { label: "\u8840\u6C27", unit: "%", field: "spo2_pct" }, stress: { label: "\u538B\u529B", unit: "\u6E90\u8BC4\u5206 0\u2013100", field: "stress_score" }, weight: { label: "\u4F53\u91CD/\u4F53\u6210\u5206", unit: null, field: "value" }, abnormal_heart_beat: { label: "\u4E91\u7AEF\u5F02\u5E38\u5FC3\u8DF3\u4E8B\u4EF6", unit: "\u79D2", field: "duration_seconds" }, intensity: { label: "\u8FD0\u52A8\u5F3A\u5EA6", unit: null, field: "value" }, valid_stand: { label: "\u6709\u6548\u7AD9\u7ACB", unit: null, field: "value" }, energy: { label: "\u80FD\u91CF", unit: null, field: "value" }, goal: { label: "\u76EE\u6807", unit: null, field: "value" }, pai: { label: "PAI", unit: null, field: "value" }, blood_pressure: { label: "\u8840\u538B\u8BB0\u5F55", unit: null, field: "value" }, blood_sugar: { label: "\u8840\u7CD6\u8BB0\u5F55", unit: null, field: "value" }, headset: { label: "\u8033\u673A\u76F8\u5173\u8BB0\u5F55", unit: null, field: "value" }, vo2_max: { label: "\u6700\u5927\u6444\u6C27\u91CF\u8BB0\u5F55", unit: null, field: "value" }, menstruation: { label: "\u751F\u7406\u5468\u671F\u8BB0\u5F55", unit: null, field: "value" } };
function sportFields(raw) {
  try {
    return projectHealth(value(JSON.parse(raw)), 0);
  } catch {
    return null;
  }
}
async function queryRecords(env, metrics, start, end, limit = 2e3, cursor) {
  validRange(start, end);
  if (!metrics.length || metrics.some((m) => !keys.includes(m))) throw new CollectorError("INVALID_METRIC");
  if (!Number.isInteger(limit) || limit < 1 || limit > 2e3) throw new CollectorError("INVALID_LIMIT");
  let afterTime = -1, afterId = "";
  if (cursor !== void 0) {
    try {
      const c = JSON.parse(atob(cursor));
      if (!Array.isArray(c) || c.length !== 2 || !Number.isSafeInteger(c[0]) || typeof c[1] !== "string" || c[1].length > 100) throw 0;
      afterTime = c[0];
      afterId = c[1];
    } catch {
      throw new CollectorError("INVALID_CURSOR");
    }
  }
  const r = await db(env).prepare(`SELECT record_id,metric,recorded_at,date_cn,source_hash,raw_json,clean_json,parse_status,synced_at FROM raw_records WHERE metric IN (${metrics.map(() => "?").join(",")}) AND date_cn>=? AND date_cn<=? AND (recorded_at>? OR (recorded_at=? AND record_id>?)) ORDER BY recorded_at,record_id LIMIT ?`).bind(...metrics, start, end, afterTime, afterTime, afterId, limit + 1).all();
  const rows = r.results.slice(0, limit), last = rows.at(-1), hrvEvidence = metrics.includes("sleep") ? await readHRVEvidence(env, start, end) : [];
  return { records: rows.map((x) => ({ record_ref: x.record_id, source_ref: x.source_hash, raw_record_tool: "get_raw_record", ...x.metric === "sleep" ? { sleep_record_ref: x.record_id, hrv: attachHRVEvidence(sleepHRVFromRaw(x.raw_json), x.date_cn, x.record_id, hrvEvidence) } : {}, ...x.metric === "sport" ? { record_ref: x.record_id, source_numeric_fields: sportFields(x.raw_json) } : {}, metric: x.metric, at: x.recorded_at, date: x.date_cn, data: (() => {
    const data = normalizedData(x.metric, x.raw_json);
    if (x.metric === "sleep" && data) data.hrv = attachHRVEvidence(sleepHRVFromRaw(x.raw_json), x.date_cn, x.record_id, hrvEvidence);
    return data;
  })(), field_metadata: fieldSemantics(x.metric, normalizedData(x.metric, x.raw_json) ?? {}), ...x.metric === "sport" ? { source_field_metadata: fieldSemantics("sport", sportFields(x.raw_json) ?? {}, true) } : {}, status: x.parse_status, syncedAt: x.synced_at })), truncated: r.results.length > limit, next_cursor: r.results.length > limit && last ? btoa(JSON.stringify([last.recorded_at, last.record_id])) : null, limit, data_contract: dataContract, source: "xiaomi_cloud", timezone: "Asia/Shanghai" };
}
async function hrvRecords(env, start, end, limit = 2e3, cursor) {
  const page = await queryRecords(env, ["sleep"], start, end, limit, cursor);
  const records = page.records.map((r) => ({ sleep_record_ref: r.sleep_record_ref, date: r.date, recorded_at: r.at, start_at: r.data?.start_at ?? null, end_at: r.data?.end_at ?? null, syncedAt: r.syncedAt, ...r.hrv }));
  return { ...page, records, supported: true, status: records.some((r) => r.source_fields_present) ? "source_fields_available" : "no_source_fields_in_page", reason: "SLEEP_SOURCE_HRV_PARTIAL_UNIT_VERIFICATION_ALGORITHM_UNVERIFIED", startDate: start, endDate: end, unit: null, algorithm: null, validated_hrv_metric: false, network_requests_performed: false };
}
async function availableMetrics(env) {
  const d = db(env), counts = (await d.prepare("SELECT metric,COUNT(*) AS records,SUM(CASE WHEN clean_json IS NOT NULL THEN 1 ELSE 0 END) AS parsed,MIN(date_cn) AS first_date,MAX(date_cn) AS latest_date,MAX(recorded_at) AS latest_record_at FROM raw_records GROUP BY metric").all()).results, checks = (await d.prepare("SELECT * FROM metric_capabilities").all()).results;
  return { metrics: keys.map((metric) => {
    const c = counts.find((x) => x.metric === metric), check = checks.find((x) => x.metric === metric);
    return { metric, ...metricInfo[metric], records: c?.records ?? 0, parsed: c?.parsed ?? 0, first_date: c?.first_date ?? null, latest_date: c?.latest_date ?? null, latest_record_at: c?.latest_record_at ?? null, status: c ? "data_available" : check?.status ?? "not_tested", last_checked: check?.last_checked ?? null, last_test_status: check?.status ?? null, error_code: check?.error_code ?? null, hardware_support: "not_inferred_from_empty_results" };
  }), hrv: { status: "unverified", source: "sleep.value", reader: "get_hrv_trend", unit: null, algorithm: null, reason: "SLEEP_SOURCE_FIELDS_READABLE_PARTIAL_UNIT_VERIFICATION" }, timezone: "Asia/Shanghai", scope: "documented_reference_channels_not_a_complete_vendor_catalogue" };
}
async function daily(env, date) {
  validRange(date, date, 1);
  return buildDaily(env, date);
}
async function syncStatus(env) {
  const d = db(env);
  const job = await d.prepare('SELECT start_date,end_date,metric_index,"current_date",complete,updated_at,lease_until FROM sync_jobs WHERE id=1').first();
  const history = await d.prepare('SELECT start_date,end_date,metric_index,"current_date",complete,updated_at FROM sync_history WHERE id=1').first();
  const logs = (await d.prepare("SELECT at,status,metric,date_cn,record_count,error_code FROM sync_logs ORDER BY id DESC LIMIT 30").all()).results;
  const counts = (await d.prepare("SELECT metric,COUNT(*) AS records,MIN(date_cn) AS first_date,MAX(date_cn) AS latest_date,SUM(CASE WHEN clean_json IS NULL THEN 1 ELSE 0 END) AS unparsed FROM raw_records GROUP BY metric").all()).results;
  return { job, history, logs, counts, native_files: job ? await nativeSyncState(env, String(job.start_date), String(job.end_date)) : null, quarantine: { records: (await d.prepare("SELECT COUNT(*) AS n FROM ingestion_quarantine").first())?.n ?? 0, latest: (await d.prepare("SELECT quarantine_id AS record_ref,metric,requested_start,requested_end,reason_code,last_seen_at FROM ingestion_quarantine ORDER BY last_seen_at DESC,quarantine_id LIMIT 10").all()).results, raw_tool: "get_raw_record", component: "ingestion_quarantine", latest_limit: 10, source_time_not_invented: true, raw_preserved_with_privacy_redactions: true }, rawVersions: (await d.prepare("SELECT COUNT(*) AS count FROM raw_versions").first())?.count ?? 0, timezone: "Asia/Shanghai", today: dateCN(Math.floor(Date.now() / 1e3)), todayIncluded: true, todayIsPartial: true, automaticSyncEnabled: env.PERSIST_SYNC_ENABLED === "true", costReviewBefore: "2027-01-01", credentialsReturned: false };
}
async function weekly(env, date) {
  validRange(date, date, 1);
  const start = addDays(date, -6), summaries = (await db(env).prepare("SELECT * FROM daily_summary WHERE date_cn>=? AND date_cn<=? ORDER BY date_cn").bind(start, date).all()).results;
  return { startDate: start, endDate: date, days: summaries, stepsAggregation: "per_day_see_step_semantics", hrv: "unverified", timezone: "Asia/Shanghai" };
}
var mcpReadErrors = /* @__PURE__ */ new Set(["INVALID_METRIC_SELECTION", "INVALID_COMPACT", "INVALID_DAILY_QUERY"]);
function compactRecords(page) {
  const metadata_sets = [], known = /* @__PURE__ */ new Map();
  const records = page.records.map((row) => {
    const { field_metadata, source_field_metadata, raw_record_tool, ...record } = row;
    const shared = { metric: row.metric, field_metadata, ...source_field_metadata ? { source_field_metadata } : {} }, signature2 = JSON.stringify(shared);
    let ref = known.get(signature2);
    if (!ref) {
      ref = "meta_" + metadata_sets.length;
      known.set(signature2, ref);
      metadata_sets.push({ metadata_ref: ref, ...shared });
    }
    return { ...record, metadata_ref: ref };
  });
  return { ...page, records, compact: true, metadata_scope: "current_page", metadata_sets, raw_record_tool: "get_raw_record", network_requests_performed: false };
}
async function readMetricQuery(env, args) {
  const multiple = args.metrics !== void 0;
  if (multiple === (args.metric !== void 0)) throw new CollectorError("INVALID_METRIC_SELECTION");
  let metrics;
  if (multiple) {
    if (!Array.isArray(args.metrics) || args.metrics.length < 1 || args.metrics.length > keys.length || args.metrics.some((x) => typeof x !== "string") || new Set(args.metrics).size !== args.metrics.length) throw new CollectorError("INVALID_METRIC_SELECTION");
    metrics = args.metrics;
  } else {
    if (typeof args.metric !== "string") throw new CollectorError("INVALID_METRIC_SELECTION");
    metrics = [args.metric];
  }
  if (metrics.some((m) => !keys.includes(m))) throw new CollectorError("INVALID_METRIC");
  if (args.compact !== void 0 && typeof args.compact !== "boolean") throw new CollectorError("INVALID_COMPACT");
  if (args.cursor !== void 0 && typeof args.cursor !== "string") throw new CollectorError("INVALID_CURSOR");
  const range = validRange(args.start_date, args.end_date, multiple && metrics.some((m) => m === "heart_rate" || m === "resting_heart_rate") ? 31 : 90);
  const limit = args.limit === void 0 ? multiple ? 200 : 2e3 : typeof args.limit === "number" ? args.limit : NaN;
  const page = await queryRecords(env, metrics, range.start, range.end, limit, args.cursor);
  return args.compact ?? multiple ? compactRecords(page) : page;
}
async function readDailyQuery(env, args) {
  if (args.date !== void 0) {
    if (typeof args.date !== "string" || args.start_date !== void 0 || args.end_date !== void 0) throw new CollectorError("INVALID_DAILY_QUERY");
    return daily(env, args.date);
  }
  if (typeof args.start_date !== "string" || typeof args.end_date !== "string") throw new CollectorError("INVALID_DAILY_QUERY");
  const range = validRange(args.start_date, args.end_date, 7), days = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const r = await daily(env, date);
    days.push({ date: r.date, day_status: r.day_status, summary: r.summary, steps: r.metrics.steps, field_metadata: r.field_metadata, quality: r.quality, sync: r.sync, hrv: r.hrv });
  }
  return { start_date: range.start, end_date: range.end, days, max_days: 7, view: "facts_from_current_cache", details_tools: ["get_metric_records", "get_hrv_trend"], data_contract: dataContract, source: "xiaomi_cloud_cache", timezone: "Asia/Shanghai", network_requests_performed: false };
}
var dates = { start_date: { type: "string", description: "\u5317\u4EAC\u65F6\u95F4\u8D77\u59CB\u65E5\u671F YYYY-MM-DD" }, end_date: { type: "string", description: "\u5317\u4EAC\u65F6\u95F4\u7ED3\u675F\u65E5\u671F YYYY-MM-DD\uFF0C\u53EF\u5305\u542B\u4ECA\u5929" } };
var paging = { cursor: { type: "string", maxLength: 1024 }, limit: { type: "integer", minimum: 1, maximum: 2e3 } };
var definitions = [
  { name: "trigger_sync", props: { sync_id: { type: "string", description: "\u9996\u8C03\u7528\u7701\u7565\uFF1Bpartial \u65F6\u4F20\u56DE\u540C\u4E00 sync_id \u7EE7\u7EED\uFF0C\u7981\u6B62\u91CD\u5F00\u4EFB\u52A1\u3002" }, retry_failed: { type: "boolean", description: "\u9ED8\u8BA4false\u3002\u4EC5\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u91CD\u8BD5\u4E14\u9519\u8BEF\u5DF2\u5904\u7406\u540E\u8BBE\u4E3Atrue\uFF1B\u4E0D\u5F97\u81EA\u52A8\u91CD\u8BD5\u8BA4\u8BC1\u3002" } }, description: "\u5199\u5165\u5DE5\u5177\uFF1A\u6309\u7528\u6237\u660E\u786E\u540C\u6B65\u8BF7\u6C42\u5237\u65B0\u5317\u4EAC\u65F6\u95F4\u4ECA\u5929\u548C\u6628\u5929\u7684\u5168\u90E8\u5DF2\u6709\u6307\u6807\uFF0C\u6BCF\u6B21\u6709\u9650\u6279\u6B21\uFF0C\u5E76\u590D\u7528\u672C\u6B21\u4F1A\u8BDD\u83B7\u53D6\u6700\u591A1\u6761\u7A97\u53E3\u5185\u7F3A\u5931\u7684\u539F\u751F\u8FD0\u52A8\u6587\u4EF6\u3002\u5DF2\u6709\u6587\u4EF6\u53CA\u5931\u8D25/\u7A7A\u54CD\u5E94\u4E0D\u81EA\u52A8\u91CD\u6293\u3002partial \u65F6\u5FC5\u987B\u4EE5\u540C\u4E00sync_id\u7EE7\u7EED\u8C03\u7528\u76F4\u5230completed\u6216completed_with_errors\uFF0C\u4E4B\u540E\u624D\u80FD\u8BFB\u53D6\u6458\u8981\u5206\u6790\uFF1Brunning\u65F6\u67E5\u8BE2get_sync_progress\uFF1Bbusy\u4E14\u8BF7\u6C42\u672A\u542F\u52A8\u65F6\u7B49\u5F85\u540E\u91CD\u65B0trigger_sync\uFF0C\u5931\u8D25\u7ACB\u5373\u505C\u6B62\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5\u767B\u5F55\u3002\u4E24\u5206\u949F\u5185\u590D\u7528\u5B8C\u6210\u7ED3\u679C\uFF0C\u4FDD\u7559\u72EC\u7ACB\u5386\u53F2\u56DE\u586B\u65AD\u70B9\u3002" },
  { name: "get_sync_progress", props: { sync_id: { type: "string", description: "\u53EF\u7701\u7565\u4EE5\u67E5\u770B\u5F53\u524D\u5B9E\u65F6\u540C\u6B65\uFF1B\u4F20\u56DEtrigger_sync\u8FD4\u56DE\u7684ID\u3002" } }, description: "\u53EA\u8BFB\u540C\u6B65\u8FDB\u5EA6\u3001\u5206\u65E5\u6307\u6807\u6210\u529F/\u7A7A\u7ED3\u679C/\u5931\u8D25\u3001\u539F\u751F\u8FD0\u52A8\u6587\u4EF6\u5F85\u83B7\u53D6/\u5DF2\u4FDD\u5B58/\u5931\u8D25\u6570\u91CF\u3001\u6700\u65B0\u6570\u636E\u65F6\u95F4\u53CA\u4E0B\u4E00\u6B65\u3002\u8BE5\u5DE5\u5177\u4E0D\u6267\u884C\u540C\u6B65\uFF1Bpartial \u9700\u8981trigger_sync\u7EE7\u7EED\uFF0Crunning\u7B49\u5F85\uFF0Cfailed\u505C\u6B62\u3002" },
  { name: "get_daily_summary", props: { date: { type: "string", description: "\u517C\u5BB9\u5355\u65E5\u5B8C\u6574\u6570\u636E\uFF1B\u4E0Estart_date/end_date\u4E8C\u9009\u4E00\u3002" }, ...dates }, description: "\u53EA\u8BFB\u6BCF\u65E5\u4E8B\u5B9E\u6570\u636E\uFF0C\u542B\u5DF2\u6838\u9A8C\u65E5\u6B65\u6570\u53E3\u5F84\u3001\u7761\u7720\u3001\u5FC3\u7387\u3001HRV\u5B57\u6BB5\u3001\u5355\u4F4D\u4E0E\u7F13\u5B58\u8D28\u91CF\uFF1B\u4E0D\u505A\u5065\u5EB7\u8BC4\u4EF7\u3002\u4F20date\u4FDD\u7559\u539F\u5355\u65E5\u54CD\u5E94\uFF0C\u6216\u6210\u5BF9\u4F20start_date/end_date\u8BFB\u53D6\u6700\u591A7\u65E5\u7CBE\u7B80\u6570\u636E\u4F9BAI\u7EC4\u7EC7\u62A5\u544A\u3002\u4E0D\u89E6\u53D1\u540C\u6B65\uFF0C\u7A7A\u7ED3\u679C\u4E0D\u4EE3\u8868\u96F6\u3002" },
  { name: "get_sleep_records", props: { ...dates, ...paging }, description: "\u53EA\u8BFB\u7761\u7720\u8BB0\u5F55\u4E0E\u5206\u671F\uFF0C\u6700\u591A90\u5929\uFF0C\u652F\u6301\u6E38\u6807\u3002" },
  { name: "get_hrv_trend", props: { ...dates, ...paging }, description: "\u5206\u9875\u8BFB\u53D6\u7F13\u5B58\u7761\u7720HRV\u539F\u59CB\u5B57\u6BB5\uFF0C\u6700\u591A90\u5929\uFF1B\u4E94\u4E2A\u6C47\u603B\u5B57\u6BB5\u6309\u6240\u6709\u8005App\u5BF9\u8D26\u4E3Ams\uFF1B\u5176\u4F59\u5B57\u6BB5\u5355\u4F4D\u53CA\u7B97\u6CD5\u672A\u9A8C\u8BC1\uFF0C\u542B\u96F6\u5360\u4F4D\u8BB0\u5F55\uFF0C\u4E0D\u4ECE\u5FC3\u7387\u63A8\u7B97\u3002" },
  { name: "get_heart_rate", props: { ...dates, ...paging }, description: "\u53EA\u8BFB\u5168\u5929\u53CA\u9759\u606F\u5FC3\u7387\uFF0C\u6700\u591A31\u5929\uFF0C\u6BCF\u9875\u6700\u591A2000\u6761\uFF0C\u4F7F\u7528next_cursor\u8BFB\u53D6\u540E\u7EED\u9875\u3002" },
  { name: "get_activity_records", props: { ...dates, ...paging }, description: "\u53EA\u8BFB\u8FD0\u52A8\u8BB0\u5F55\uFF0C\u6700\u591A90\u5929\u3002" },
  { name: "get_weekly_report", props: { date: { type: "string" } }, description: "\u622A\u81F3\u6307\u5B9A\u65E5\u7684\u4E03\u5929\u7ED3\u6784\u5316\u8BB0\u5F55\u62A5\u544A\uFF0C\u672A\u9A8C\u8BC1\u6C47\u603B\u660E\u786E\u6807\u8BB0\u3002" },
  { name: "get_sync_status", props: { ...dates, metric: { type: "string", enum: [...keys] } }, description: "\u4E0D\u4F20\u53C2\u6570\u65F6\u517C\u5BB9\u539F\u6709\u540C\u6B65\u72B6\u6001\u3002\u53EF\u9009\u6210\u5BF9\u4F20\u65E5\u671F\u8303\u56F4\uFF08\u6700\u591A31\u5929\uFF09\u548Cmetric\uFF0C\u8BFB\u53D6\u9010\u65E5\u7F13\u5B58\u8986\u76D6\u4E0E\u6700\u8FD1\u540C\u6B65\u7ED3\u679C\uFF1B\u7A7A\u9875\u3001\u5931\u8D25\u3001\u672A\u68C0\u67E5\u5206\u522B\u6807\u8BB0\uFF0C\u4E0A\u4F20\u5B8C\u6574\u6027\u4FDD\u6301unknown\uFF0C\u4E0D\u89E6\u53D1\u540C\u6B65\u3002" },
  { name: "get_raw_record", props: { record_ref: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 256, maximum: 16384 }, snapshot_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }, component: { type: "string", enum: ["metric_record", "activity_operational", "ingestion_quarantine"] } }, description: "\u53EA\u8BFB\u7F13\u5B58\u539F\u59CBJSON\uFF0C\u4FDD\u7559\u672A\u77E5\u5B57\u6BB5\u3001\u539F\u503C\u548C\u957F\u6570\u7EC4\uFF0C\u79FB\u9664\u51ED\u636E/\u8EAB\u4EFD/\u4F4D\u7F6E/URL\u3002component\u9ED8\u8BA4metric_record\uFF1Bactivity_operational\u8BFB\u53D6\u5B8C\u6574\u8FD0\u52A8\u9644\u52A0\u54CD\u5E94\uFF0Cingestion_quarantine\u8BFB\u53D6\u9694\u79BB\u539F\u6587\uFF08\u5F15\u7528\u89C1get_sync_status\uFF09\u3002\u65E7\u6295\u5F71\u7F13\u5B58\u7F3A\u539F\u6587\u4F1A\u660E\u786E\u8FD4\u56DE\uFF0C\u4E0D\u89E6\u53D1\u8865\u91C7\u3002\u901A\u8FC7\u660E\u7EC6record_ref\u8BFB\u53D6\uFF1B\u8DDF\u968Fnext_offset\u5E76\u4F20\u540C\u4E00snapshot_hash\u62FC\u63A5raw_json_chunk\uFF0C\u5B8C\u6210\u540E\u89E3\u6790JSON\u3002RECORD_CHANGED_RESTART\u65F6\u4ECE0\u91CD\u8BFB\uFF0C\u4E0D\u89E6\u53D1\u4E91\u7AEF\u91C7\u96C6\u3002" },
  { name: "list_available_metrics", props: {}, description: "\u5217\u51FA21\u79CD\u53C2\u8003\u9879\u76EE\u6570\u636E\u6E20\u9053\u53CA\u672C\u8D26\u53F7\u5B9E\u9645\u6709\u6570\u636E/\u7A7A\u7ED3\u679C/\u9519\u8BEF/\u5C1A\u672A\u6D4B\u8BD5\u72B6\u6001\uFF0CHRV\u53E6\u884C\u6807\u8BB0\u672A\u9A8C\u8BC1\u3002" },
  { name: "get_metric_records", props: { metrics: { type: "array", items: { type: "string", enum: [...keys] }, minItems: 1, maxItems: keys.length, uniqueItems: true, description: "\u63A8\u8350\uFF1A\u4E00\u4E2A\u6216\u591A\u4E2A\u6307\u6807\uFF1B\u5FC3\u7387\u548C\u9759\u606F\u5FC3\u7387\u53EF\u4E00\u8D77\u8BFB\u53D6\u3002\u4E0Emetric\u4E8C\u9009\u4E00\u3002" }, metric: { type: "string", enum: [...keys], description: "\u517C\u5BB9\u539F\u5355\u6307\u6807\u8C03\u7528\uFF0C\u4E0Emetrics\u4E8C\u9009\u4E00\u3002" }, ...dates, ...paging, compact: { type: "boolean", description: "metrics\u8C03\u7528\u9ED8\u8BA4true\uFF0C\u9875\u7EA7metadata_sets\u4FDD\u7559\u9010\u8BB0\u5F55\u5143\u6570\u636E\u5DEE\u5F02\uFF1B\u65E7metric\u8C03\u7528\u9ED8\u8BA4false\u4FDD\u6301\u539F\u54CD\u5E94\u3002" } }, description: "\u6309metrics\u5206\u9875\u8BFB\u53D6\u7F13\u5B58\u660E\u7EC6\uFF0C\u652F\u6301\u591A\u6307\u6807\uFF1B\u9ED8\u8BA4\u6BCF\u9875200\u6761\uFF0Cnext_cursor\u7FFB\u9875\uFF0C\u5305\u542B\u5FC3\u7387\u65F6\u6700\u591A31\u5929\uFF0C\u5426\u521990\u5929\u3002\u5171\u540C\u5B57\u6BB5\u5143\u6570\u636E\u5728metadata_sets\uFF0C\u8BB0\u5F55\u901A\u8FC7metadata_ref\u5F15\u7528\uFF1B\u539F\u6587\u7528record_ref\u8BFB\u53D6\u3002\u65E7metric\u8C03\u7528\u4FDD\u7559\u539F\u7ED3\u6784\u30012000\u6761\u9ED8\u8BA4\u9875\u5927\u5C0F\u53CA\u539F\u8303\u56F4\u3002\u4E0D\u89E6\u53D1\u540C\u6B65\uFF0C\u672A\u77E5\u5355\u4F4D\u4E0D\u731C\u6D4B\u3002" },
  { name: "get_steps_records", props: { ...dates, ...paging }, description: "\u8BFB\u53D6\u6B65\u6570\u3001\u8DDD\u79BB\u4E0E\u6D88\u8017\u91C7\u6837\u660E\u7EC6\uFF1B\u5355\u6761\u4E0D\u662F\u5F53\u65E5\u7D2F\u8BA1\u3002" },
  { name: "get_spo2_records", props: { ...dates, ...paging }, description: "\u8BFB\u53D6\u5B9E\u9645\u8FD4\u56DE\u7684\u8840\u6C27\u767E\u5206\u6BD4\u8BB0\u5F55\uFF0C\u7A7A\u7ED3\u679C\u4E0D\u4EE3\u8868\u786C\u4EF6\u4E0D\u652F\u6301\u3002" },
  { name: "get_stress_records", props: { ...dates, ...paging }, description: "\u8BFB\u53D6\u6E90\u538B\u529B\u8BC4\u5206\u8BB0\u5F55\uFF0C\u4FDD\u75590\u5206\uFF0C\u4E0D\u4F5C\u533B\u5B66\u8BCA\u65AD\u3002" },
  { name: "get_activity_heart_rate_samples", props: { record_ref: { type: "string", maxLength: 100 }, offset: { type: "integer", minimum: 0, maximum: 21600 }, limit: { type: "integer", minimum: 1, maximum: 2e3 } }, description: "\u53EA\u8BFB\u539F\u751F\u8FD0\u52A8\u5FC3\u7387\u7F13\u5B58\uFF1B\u4E0D\u53EF\u7528\u65F6\u4F7F\u7528\u5206\u949F\u91C7\u6837\u3002\u7528next_offset\u5206\u9875\u83B7\u53D6\u5B8C\u6574\u66F2\u7EBF\uFF0C\u8FD4\u56DE\u65F6\u95F4\u6233\u548CBPM\uFF0C\u4E0D\u8054\u7F51\u3002" },
  { name: "get_activity_heart_rate_analysis", props: { record_ref: { type: "string", maxLength: 100 } }, description: "\u53EA\u8BFB\u7F13\u5B58\u8FD0\u52A8\u5FC3\u7387\u5206\u6790\uFF1A\u89C2\u5BDF\u5CF0\u503C/\u6E90\u5CF0\u503C\u3001\u91C7\u6837\u95F4\u9694\u3001\u56FA\u5B9ABPM\u5206\u5E03\u3001\u6E90\u8BAD\u7EC3\u8D1F\u8377\u53EF\u4FE1\u5EA6\u53CA\u8FD0\u52A8\u540E\u89C2\u5BDF\u3002\u65E0\u52A8\u4F5C\u8D77\u6B62\u65F6\u95F4\u4E0D\u63A8\u6D4B\u7EC4\u95F4\u6062\u590D\uFF1B\u4E0D\u89E6\u53D1\u5C0F\u7C73\u8BF7\u6C42\u3002" },
  { name: "get_activity_detail", props: { record_ref: { type: "string", maxLength: 100 }, include_samples: { type: "boolean" }, sample_limit: { type: "integer", minimum: 1, maximum: 2e3 } }, description: "\u6309\u8FD0\u52A8\u8BB0\u5F55record_ref\u8BFB\u53D6\u5355\u6B21\u8FD0\u52A8\u8BE6\u60C5\u4E0E\u53EF\u9009\u5FC3\u7387\u91C7\u6837\uFF1B\u5168\u5929\u5FC3\u7387\u5173\u8054\u4E0E\u539F\u751F\u8FD0\u52A8\u66F2\u7EBF\u660E\u786E\u533A\u5206\uFF0C\u4E0D\u89E6\u53D1\u91C7\u96C6\u3002" },
  { name: "get_steps_audit", props: { ...dates }, description: "\u6700\u591A31\u5929\uFF0C\u6838\u5BF9\u624B\u673A\u53C2\u8003\u6B65\u6570\u3001\u4E91\u7AEF\u65E5\u805A\u5408\u53CA\u5404\u6765\u6E90\u8BA1\u7B97\u53E3\u5F84\uFF0C\u53EA\u8BFB\u4E0D\u4FEE\u6539\u6570\u636E\u3002" },
  { name: "get_body_measurements", props: { ...dates, ...paging }, description: "\u8BFB\u53D6\u4F53\u91CD/\u4F53\u6210\u5206\u6E90\u6570\u503C\uFF1B\u5C1A\u672A\u6838\u5B9E\u7684\u5355\u4F4D\u660E\u786E\u6807\u6CE8\u3002" }
];
var commonTools = /* @__PURE__ */ new Set(["trigger_sync", "get_sync_progress", "get_sync_status", "list_available_metrics", "get_metric_records", "get_raw_record", "get_daily_summary", "get_hrv_trend", "get_activity_detail", "get_activity_heart_rate_samples"]);
var compatibleMcpTools = definitions.map((x) => ({ name: x.name, description: x.description, annotations: { readOnlyHint: x.name !== "trigger_sync", destructiveHint: false, openWorldHint: x.name === "trigger_sync", ...x.name === "trigger_sync" ? { idempotentHint: false } : {} }, inputSchema: { type: "object", properties: x.props, required: ["get_sync_status", "get_daily_summary"].includes(x.name) ? [] : x.name === "get_metric_records" ? ["start_date", "end_date"] : Object.keys(x.props).filter((k) => !["cursor", "limit", "include_samples", "sample_limit", "sync_id", "retry_failed", "offset", "snapshot_hash", "component"].includes(k)), additionalProperties: false, ...x.name === "get_metric_records" ? { oneOf: [{ required: ["metric"] }, { required: ["metrics"] }] } : {}, ...x.name === "get_daily_summary" ? { oneOf: [{ required: ["date"], not: { anyOf: [{ required: ["start_date"] }, { required: ["end_date"] }] } }, { required: ["start_date", "end_date"], not: { required: ["date"] } }] } : {} } }));
var mcpTools = compatibleMcpTools.filter((x) => commonTools.has(x.name));
async function toolCall(env, name, args) {
  const tool = compatibleMcpTools.find((t) => t.name === name);
  if (!tool) throw new CollectorError("UNKNOWN_TOOL");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !Object.keys(tool.inputSchema.properties).includes(k))) throw new CollectorError("INVALID_ARGUMENTS");
  if (name === "get_raw_record") {
    if (typeof args.record_ref !== "string" || args.offset !== void 0 && typeof args.offset !== "number" || args.limit !== void 0 && typeof args.limit !== "number" || args.snapshot_hash !== void 0 && typeof args.snapshot_hash !== "string" || args.component !== void 0 && typeof args.component !== "string") throw new CollectorError("INVALID_ARGUMENTS");
    return rawRecord(env, args.record_ref, args.offset, args.limit, args.snapshot_hash, args.component);
  }
  if (name === "trigger_sync" || name === "get_sync_progress") {
    if (args.sync_id !== void 0 && typeof args.sync_id !== "string" || args.retry_failed !== void 0 && typeof args.retry_failed !== "boolean") throw new CollectorError("INVALID_ARGUMENTS");
    return name === "trigger_sync" ? triggerSync(env, args.sync_id, void 0, void 0, args.retry_failed === true) : getSyncProgress(env, args.sync_id);
  }
  if (name === "get_activity_heart_rate_samples") {
    if (typeof args.record_ref !== "string" || args.offset !== void 0 && typeof args.offset !== "number" || args.limit !== void 0 && typeof args.limit !== "number") throw new CollectorError("INVALID_ARGUMENTS");
    return activityHeartRateSamples(env, args.record_ref, args.offset, args.limit);
  }
  if (name === "get_activity_heart_rate_analysis") {
    if (typeof args.record_ref !== "string") throw new CollectorError("INVALID_ARGUMENTS");
    return activityHeartRateAnalysis(env, args.record_ref);
  }
  if (name === "get_activity_detail") {
    if (typeof args.record_ref !== "string" || args.include_samples !== void 0 && typeof args.include_samples !== "boolean" || args.sample_limit !== void 0 && typeof args.sample_limit !== "number") throw new CollectorError("INVALID_ARGUMENTS");
    return activityDetail(env, args.record_ref, args.include_samples, args.sample_limit);
  }
  if (name === "get_steps_audit") {
    const r = validRange(args.start_date, args.end_date, 31);
    return (await stepsAudit(env, r.start, r.end)).result;
  }
  if (name === "get_sync_status") {
    const status = await syncStatus(env);
    if (args.start_date === void 0 && args.end_date === void 0 && args.metric === void 0) return status;
    const r = validRange(args.start_date, args.end_date, 31);
    if (args.metric !== void 0 && typeof args.metric !== "string") throw new CollectorError("INVALID_METRIC");
    return { ...status, coverage: await dataCoverage(env, r.start, r.end, args.metric) };
  }
  if (name === "list_available_metrics") return availableMetrics(env);
  if (name === "get_daily_summary") return readDailyQuery(env, args);
  if (name === "get_weekly_report") return weekly(env, String(args.date ?? ""));
  if (name === "get_metric_records") return readMetricQuery(env, args);
  const { start, end } = validRange(args.start_date, args.end_date, name === "get_heart_rate" ? 31 : 90);
  if (name === "get_hrv_trend") {
    if (args.cursor !== void 0 && typeof args.cursor !== "string") throw new CollectorError("INVALID_CURSOR");
    return hrvRecords(env, start, end, args.limit === void 0 ? 2e3 : typeof args.limit === "number" ? args.limit : NaN, args.cursor);
  }
  const map = { get_sleep_records: ["sleep"], get_heart_rate: ["heart_rate", "resting_heart_rate"], get_activity_records: ["sport"], get_steps_records: ["steps"], get_spo2_records: ["spo2"], get_stress_records: ["stress"], get_body_measurements: ["weight"] };
  const metrics = map[name];
  if (args.cursor !== void 0 && typeof args.cursor !== "string") throw new CollectorError("INVALID_CURSOR");
  return queryRecords(env, metrics, start, end, args.limit === void 0 ? 2e3 : typeof args.limit === "number" ? args.limit : NaN, args.cursor);
}
async function rpc(env, body) {
  const id = body.id ?? null, params = body.params;
  try {
    if (body.method === "server/discover") return { jsonrpc: "2.0", id, result: { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } } };
    if (body.method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "xiaomi-personal-health", version: "2.0.0" } } };
    if (body.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: mcpTools } };
    if (body.method === "tools/call") {
      const result = await toolCall(env, String(params?.name ?? ""), params?.arguments ?? {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } };
    }
    if (body.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "METHOD_NOT_FOUND" } };
  } catch (e) {
    return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: e instanceof CollectorError && (rawReadErrors.has(e.code) || mcpReadErrors.has(e.code)) ? e.code : "INVALID_QUERY_OR_DATABASE_UNAVAILABLE" }) }] } };
  }
}
async function rebuildQuality(env, start, end) {
  validRange(start, end, 31);
  const d = db(env), token2 = crypto.randomUUID();
  const acquired = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(token2, Date.now() + 18e4, Date.now()).run();
  if (!acquired.meta.changes) throw new CollectorError("SYNC_BUSY");
  const fingerprint = async () => {
    const r = (await d.prepare("SELECT record_id,raw_json FROM raw_records WHERE metric<>'steps_daily_aggregate' ORDER BY record_id").all()).results;
    return { records: r.length, sha256: await hash(JSON.stringify(r)) };
  };
  try {
    const before = await fingerprint(), versionsBefore = (await d.prepare("SELECT COUNT(*) AS n FROM raw_versions").first())?.n;
    const a = new MiFitnessAdapter(nativeFetcher(true), void 0, void 0, { totalWaitMs: 1500, maxWaitMs: 1e3 });
    await a.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
    const page = await a.page("steps_daily_aggregate", start, end, null);
    if (page.hasMore) throw new CollectorError("REPORT_PAGE_NOT_COMPLETE");
    await saveRecords(d, "steps_daily_aggregate", page.records, Date.now());
    const rows = (await d.prepare("SELECT record_id,metric,raw_json FROM raw_records WHERE metric IN ('sleep','sport') AND date_cn>=? AND date_cn<=?").bind(start, end).all()).results;
    const updates = [];
    for (const r of rows) {
      try {
        const p = parseRecord(r.metric, JSON.parse(r.raw_json));
        updates.push(d.prepare("UPDATE raw_records SET clean_json=?,parse_status='parsed',date_cn=? WHERE record_id=?").bind(JSON.stringify(p.data), p.date, r.record_id));
      } catch {
        updates.push(d.prepare("UPDATE raw_records SET clean_json=NULL,parse_status='schema_unverified' WHERE record_id=?").bind(r.record_id));
      }
    }
    for (let i = 0; i < updates.length; i += 50) await d.batch(updates.slice(i, i + 50));
    const verified = await (await Promise.resolve().then(() => (init_step_audit(), step_audit_exports))).verifySteps(env, start, end);
    const range = dateRange(start, end);
    for (let t = range.start; t <= range.end; t += 86400) await summarize(d, dateCN(t), Date.now());
    const after = await fingerprint();
    if (before.sha256 !== after.sha256) throw new CollectorError("RAW_PRESERVATION_CHECK_FAILED");
    return { status: "complete", start_date: start, end_date: end, daily_reports_saved: page.records.length, normalized_records_rebuilt: rows.length, steps_verification: verified, raw_before: before, raw_after: after, raw_preserved: true, raw_versions_before: versionsBefore, raw_versions_after: (await d.prepare("SELECT COUNT(*) AS n FROM raw_versions").first())?.n, parser_version: "quality-v2" };
  } finally {
    await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(token2).run();
  }
}

// src/hrv-cloud-probe.ts
init_http();
init_parser();

// src/hrv-source-inspection.ts
init_parser();
var sensitive = /(?:id$|sid|mac|imei|imsi|phone|lat|lon|lng|gps|route|track|coordinate|location|address|token|cookie|password|security|user)/i;
function inspectHRVTree(input) {
  const hrv_fields = [], arrays = [], strings = [];
  let nodes = 0, truncated = false;
  function visit(v, path, depth) {
    if (++nodes > 2e4 || depth > 24) {
      truncated = true;
      return;
    }
    if (Array.isArray(v)) {
      arrays.push({ path, length: v.length, item_keys: [...new Set(v.slice(0, 20).flatMap((x) => x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).filter((k) => !sensitive.test(k)) : []))] });
      for (let i = 0; i < v.length; i++) {
        if (nodes > 2e4) {
          truncated = true;
          break;
        }
        visit(v[i], path + "[" + i + "]", depth + 1);
      }
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (sensitive.test(k) || ["next_key", "cursor", "next_cursor"].includes(k)) continue;
        const p = path ? path + "." + k : k;
        if (/hrv|rmssd|sdnn|rr_interval|rri|ibi/i.test(k)) hrv_fields.push({ path: p, type: Array.isArray(x) ? "array" : x === null ? "null" : typeof x, ...typeof x === "number" || typeof x === "boolean" || x === null ? { value: x } : {} });
        visit(x, p, depth + 1);
      }
      return;
    }
    if (typeof v === "string") {
      try {
        const d = JSON.parse(v);
        if (d && typeof d === "object") {
          strings.push({ path, length: v.length, encoding: "json" });
          visit(d, path + "::json", depth + 1);
          return;
        }
      } catch {
      }
      if (v.length >= 24 && v.length <= 3 * 1024 * 1024 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
        let bytes;
        try {
          bytes = atob(v.replace(/-/g, "+").replace(/_/g, "/")).length;
        } catch {
        }
        strings.push({ path, length: v.length, encoding: bytes === void 0 ? "opaque_string" : "base64_candidate_unverified", ...bytes === void 0 ? {} : { decoded_bytes: bytes } });
      } else strings.push({ path, length: v.length, encoding: "opaque_string" });
    }
  }
  visit(input, "", 0);
  return { hrv_fields, arrays, strings, nodes, truncated, source_values_modified: false };
}
async function cachedHRVInspection(env, start, end) {
  const rows = (await env.DB.prepare("SELECT record_id,date_cn,raw_json FROM raw_records WHERE metric='sleep' AND date_cn>=? AND date_cn<=? ORDER BY recorded_at,record_id LIMIT 201").bind(start, end).all()).results;
  return { source: "cached_raw_sleep", records: rows.slice(0, 200).map((r) => {
    try {
      return { sleep_record_ref: r.record_id, date: r.date_cn, inspection: inspectHRVTree(value(JSON.parse(r.raw_json))) };
    } catch {
      return { sleep_record_ref: r.record_id, date: r.date_cn, error_code: "RAW_DECODE_FAILED" };
    }
  }), truncated: rows.length > 200, network_requests_performed: false };
}

// src/hrv-cloud-probe.ts
var safeCodes = /* @__PURE__ */ new Set(["AUTH_EXPIRED", "LOGIN_REJECTED", "LOGIN_HTTP_ERROR", "INTERACTIVE_AUTH_REQUIRED", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "UPSTREAM_BUSINESS_ERROR", "UPSTREAM_HTTP_ERROR", "NETWORK_FAILURE", "INVALID_CLOUD_RESPONSE", "RESPONSE_TOO_LARGE", "HRV_PROBE_LIMIT", "UPSTREAM_RATE_LIMITED"]);
async function probeHRVCloud(env, date, transport = nativeFetcher(true)) {
  dateRange(date, date);
  if (!env.DB || !env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
  if (Date.now() >= Date.parse("2027-01-01T00:00:00+08:00")) throw new CollectorError("HOSTING_COST_REVIEW_REQUIRED");
  const d = env.DB, old = await d.prepare("SELECT status,audit_json FROM hrv_probe_cache WHERE date_cn=?").bind(date).first();
  if (old) return { status: old.status, ...JSON.parse(old.audit_json), cached: true, network_requests_performed: false };
  const lease = "hrv_probe_" + crypto.randomUUID(), active = await d.prepare("SELECT lease_until FROM sync_jobs WHERE id=1").first();
  if (active && active.lease_until > Date.now()) throw new CollectorError("SYNC_BUSY");
  if (active) {
    const lock = await d.prepare("UPDATE sync_jobs SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=?").bind(lease, Date.now() + 15e4, Date.now()).run();
    if (!lock.meta.changes) throw new CollectorError("SYNC_BUSY");
  }
  const claim = await d.prepare("INSERT OR IGNORE INTO hrv_probe_cache(date_cn,status,audit_json,raw_json,checked_at) VALUES(?,'checking','{}','{}',?)").bind(date, Date.now()).run();
  if (!claim.meta.changes) {
    if (active) await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(lease).run();
    throw new CollectorError("HRV_PROBE_BUSY");
  }
  const results = [], raw = {};
  let lastStatus = null, healthRequests = 0, status = "complete", error_code = null;
  const once = async (url, init) => {
    const health = new URL(url).hostname === "hlth.io.mi.com";
    if (health && ++healthRequests > 2) throw new CollectorError("HRV_PROBE_LIMIT");
    let r;
    try {
      r = await transport(url, init);
    } catch {
      throw new CollectorError("NETWORK_FAILURE");
    }
    if (health) {
      lastStatus = r.status;
      if (r.status !== 200) {
        await r.body?.cancel();
        throw new CollectorError(r.status === 401 || r.status === 403 ? "AUTH_EXPIRED" : r.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP_ERROR");
      }
    }
    return r;
  };
  try {
    const adapter = new MiFitnessAdapter(once, async () => {
      throw new CollectorError("HRV_PROBE_LIMIT");
    }, void 0, { maxWaitMs: 0, totalWaitMs: 0 });
    await adapter.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
    const window = dateRange(addDays(date, -1), date), day = dateRange(date, date), plan = [{ channel: "raw_hrv_candidate", endpoint: FITNESS_PATH, payload: { key: "hrv", start_time: window.start, end_time: window.end } }, { channel: "sleep_daily_report", endpoint: AGGREGATE_PATH, payload: { tag: "daily_report", key: "sleep", reverse: true, start_time: day.start, end_time: day.end, limit: 50 } }];
    for (const item of plan) {
      lastStatus = null;
      try {
        const response = await adapter.request(item.endpoint, item.payload);
        raw[item.channel] = stripCredentials(response);
        const records = Array.isArray(response.data_list) ? response.data_list : [];
        results.push({ channel: item.channel, endpoint: item.endpoint, requested_payload: item.payload, http_status: lastStatus, status: records.length ? "records_returned" : "no_records_returned", records: records.length, has_more: response.has_more ?? null, inspection: inspectHRVTree(stripCredentials(response)) });
        if (response.has_more === true) {
          status = "partial";
          error_code = "HRV_PROBE_PAGE_LIMIT";
          break;
        }
      } catch (e) {
        const code = e instanceof CollectorError && safeCodes.has(e.code) ? e.code : "HRV_PROBE_FAILED";
        results.push({ channel: item.channel, endpoint: item.endpoint, http_status: lastStatus, status: "failed", error_code: code });
        throw new CollectorError(code);
      }
    }
  } catch (e) {
    status = "failed";
    error_code = e instanceof CollectorError && safeCodes.has(e.code) ? e.code : "HRV_PROBE_FAILED";
  } finally {
    if (active) await d.prepare("UPDATE sync_jobs SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?").bind(lease).run();
  }
  const audit = { request_contract_version: "snake_case_seconds_v2", status, error_code, date, results, health_requests: healthRequests, login_attempts: 1, retries: 0, network_requests_performed: true, raw_preserved: "site_d1_hrv_probe_cache", series_available: "not_inferred_from_summary", checked_at: Date.now() };
  await d.prepare("UPDATE hrv_probe_cache SET status=?,audit_json=?,raw_json=?,checked_at=? WHERE date_cn=?").bind(status, JSON.stringify(audit), JSON.stringify(raw), audit.checked_at, date).run();
  return { ...audit, cached: false };
}

// src/quality-evidence.ts
init_parser();
async function qualityEvidence(env, start, end) {
  const rows = (await env.DB.prepare("SELECT metric,recorded_at,date_cn,source_hash,raw_json FROM raw_records WHERE metric IN ('sleep','steps') AND date_cn>=? AND date_cn<=? ORDER BY metric,date_cn,recorded_at LIMIT 5000").bind(start, end).all()).results;
  const sources = [...new Set(rows.map((r) => r.source_hash))].sort();
  return { sleeps: rows.filter((r) => r.metric === "sleep").map((r) => ({ date: r.date_cn, at: r.recorded_at, source: "source_" + sources.indexOf(r.source_hash), value: projectHealth(value(JSON.parse(r.raw_json))) })), steps_sources: sources.map((s, i) => {
    const records = rows.filter((r) => r.metric === "steps" && r.source_hash === s);
    return { source: "source_" + i, records: records.length, value_keys: [...new Set(records.flatMap((r) => Object.keys(value(JSON.parse(r.raw_json)))))], samples: records.slice(0, 3).map((r) => ({ date: r.date_cn, at: r.recorded_at, value: projectHealth(value(JSON.parse(r.raw_json))) })) };
  }).filter((x) => x.records), raw_fingerprint: await env.DB.prepare("SELECT COUNT(*) AS records,SUM(length(raw_json)) AS bytes FROM raw_records").first(), versions: await env.DB.prepare("SELECT COUNT(*) AS records,SUM(length(raw_json)) AS bytes FROM raw_versions").first() };
}

// src/worker.ts
init_step_audit();

// src/dashboard.ts
var dashboard = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xiaomi Band Dashboard \xB7 \u79C1\u6709\u771F\u5B9E\u6570\u636E</title><style>
:root{color-scheme:dark;--bg:#191b19;--side:#151714;--panel:#1d201c;--ink:#e6e3d9;--muted:#a5a89c;--soft:#7f8679;--line:#343a31;--accent:#b5bea4;--serif:"Iowan Old Style","Palatino Linotype","Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",serif;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink);font-size:14px}*{box-sizing:border-box}body{margin:0;line-height:1.8;-webkit-font-smoothing:antialiased}::selection{background:#59614a;color:#fff}a{color:var(--accent);text-underline-offset:4px}button,input,select{font:inherit}button,a,input,select{touch-action:manipulation}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:5px}aside{position:fixed;inset:0 auto 0 0;width:224px;padding:44px 26px 24px;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column}aside h1{font:400 27px/1.45 var(--serif);letter-spacing:3px;margin:8px 0 0}.brand-kicker,.eyebrow{color:var(--soft);font-size:10px;letter-spacing:2.6px;font-weight:500}.brand-subtitle{color:var(--muted);font-size:11px;letter-spacing:1px;margin:13px 0 0}nav{display:grid;gap:2px;margin:52px -10px 24px}nav a{display:flex;align-items:center;gap:13px;min-height:46px;padding:9px 10px;color:var(--muted);text-decoration:none;border-left:1px solid transparent;transition:color .15s,background .15s}nav a:hover{color:var(--ink);background:#ffffff03}nav a.active{border-left-color:var(--accent);color:var(--ink)}.nav-index{font:11px Georgia,serif;color:#858d7d;letter-spacing:.5px}.aside-foot{margin-top:auto;padding-top:24px;border-top:1px solid var(--line);font-size:11px;color:var(--soft)}.aside-foot span{display:block}.privacy-dot{display:inline-block;width:5px;height:5px;margin-right:7px;border-radius:50%;background:#a9b794}.aside-foot .privacy-label{margin-top:12px;color:var(--muted)}main{margin-left:224px;padding:44px clamp(26px,4.2vw,76px) 30px;max-width:1580px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-bottom:29px;border-bottom:1px solid var(--line)}h2{font:400 clamp(30px,3.4vw,43px)/1.5 var(--serif);letter-spacing:2px;margin:9px 0 4px}header .muted{font-size:12px;color:var(--muted)}.date-control{display:flex;flex-direction:column;gap:7px;color:var(--soft);font-size:10px;letter-spacing:1px;padding-bottom:5px;flex-shrink:0}input[type=date]{color:var(--ink);font-size:13px;letter-spacing:.6px;font-variant-numeric:tabular-nums;padding:7px 0 7px 10px;border:0;border-bottom:1px solid #59604f;background:transparent;border-radius:0;min-width:156px}.notice{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;color:var(--soft);font-size:11px;margin:18px 0 31px}.notice a{font-size:11px;color:var(--soft)}#content{min-height:50vh}h3{font-size:14px;font-weight:500;letter-spacing:.35px;line-height:1.7;margin:0 0 22px;color:var(--ink)}.card{padding:26px 0 28px;margin:0;border-top:1px solid var(--line);overflow:auto}.card:first-child{border-top:0}.card p{margin:10px 0}.card small{display:block;margin-top:12px;max-width:82ch}small,.muted{color:var(--muted);font-size:11px;line-height:1.9}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:25px 0 38px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.metric{padding:25px 24px 25px 0;min-width:0;min-height:160px;position:relative}.metric:nth-child(3n+2),.metric:nth-child(3n){padding-left:28px}.metric:nth-child(-n+3){border-bottom:1px solid var(--line)}.metric:not(:nth-child(3n)):after{position:absolute;content:"";right:0;top:28px;bottom:27px;border-right:1px solid var(--line)}.metric h3{color:var(--muted);font-size:12px;margin:0 0 13px;font-weight:400}.big{display:flex;align-items:baseline;gap:10px;font:400 39px/1.35 Georgia,"Times New Roman",serif;font-variant-numeric:tabular-nums;letter-spacing:-.5px;min-height:55px;color:#eeece3}.value-unit{font:11px/1.4 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;letter-spacing:0;color:var(--muted)}.value-text{font:400 23px/1.7 var(--serif);letter-spacing:.6px;overflow-wrap:anywhere}.metric small{display:block;font-size:10px;color:var(--soft);margin-top:10px;letter-spacing:.15px;overflow-wrap:anywhere}.data-note{display:flex;gap:20px;align-items:baseline;flex-wrap:wrap;padding:0 0 1px;color:var(--muted);font-size:11px}.data-note h3{font-size:11px;line-height:1.8;color:var(--soft);margin:0;white-space:nowrap}.data-note .note-body{flex:1;min-width:200px}button,select{border:1px solid #48503f;background:transparent;color:var(--muted);border-radius:2px;padding:7px 13px;font-size:12px;cursor:pointer;transition:background .15s,color .15s}button:hover,select:hover{color:var(--ink);background:#ffffff05}button.primary{background:#b5bea4;border-color:#b5bea4;color:#1a2115}button:disabled{opacity:.55;cursor:wait}select{max-width:100%;background:var(--bg)}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:23px 0 27px}.toolbar a{margin-left:auto;font-size:11px}.toolbar button[data-range]{min-width:54px;padding:6px 12px;border-color:transparent;color:var(--soft)}.toolbar button[data-range].primary{background:#303729;color:#dde3d2;border-color:#4d5842}.chart-wrap{padding:4px 0 0}.chart-axis{fill:var(--soft);font-size:10px;font-family:inherit;font-variant-numeric:tabular-nums}.chart-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:2 5}.chart-line{stroke:var(--accent);stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round;fill:none}.chart-point{fill:var(--accent);opacity:0}.chart-point:hover,.chart-point:focus{opacity:1;outline:none}svg{display:block;width:100%;height:240px;overflow:visible}table{width:100%;border-collapse:collapse;min-width:520px;font-size:12px;font-variant-numeric:tabular-nums;text-align:left}th{font-size:10px;font-weight:400;color:var(--soft);letter-spacing:.5px;padding:0 15px 12px 0;white-space:nowrap;border-bottom:1px solid #49503f}td{padding:13px 15px 13px 0;border-bottom:1px solid #30352c;color:#cdd0c3;max-width:550px;overflow-wrap:anywhere}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#ffffff02}pre{font:11px/1.9 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);margin:0}.empty{padding:48px 18px;border:1px dashed var(--line);color:var(--soft);font-size:12px;text-align:center;margin:6px 0 8px}.ok{color:var(--accent)}.fail{color:#c69986}dialog{max-width:600px;border:1px solid var(--line);border-radius:2px;background:var(--bg);color:inherit}footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--line);margin-top:28px;padding-top:19px;color:var(--soft);font-size:10px;line-height:1.8}footer a{color:var(--soft)}.footer-end{margin-left:auto;color:#7f8679;letter-spacing:1px}#detail>label{display:block;margin:0 0 25px;font-size:12px;color:var(--muted)}#workout-detail{margin-top:16px}#workout-detail .card{padding-left:18px;border-left:1px solid #59634b}#workout-detail .card .card{padding-left:0;border-left:0}p:has(>button[data-workout]){margin:0;padding:9px 0;border-bottom:1px solid var(--line)}button[data-workout]{border:0;padding:2px 0;color:var(--accent);font-size:12px}
@media(min-width:1600px){main{margin-right:auto}}@media(max-width:1000px){aside{width:190px;padding:35px 20px}aside h1{font-size:24px}main{margin-left:190px;padding:35px 28px}.metric:nth-child(3n+2),.metric:nth-child(3n){padding-left:18px}.metric{padding-right:15px}.big{font-size:34px}.metric small{font-size:10px}}@media(max-width:760px){aside{position:static;width:100%;padding:25px 22px 0;border-right:0;border-bottom:1px solid var(--line);display:block}aside h1{font-size:25px;margin:3px 0}.brand-kicker{font-size:9px}.brand-subtitle{display:none}nav{display:flex;gap:22px;overflow:auto;scrollbar-width:none;margin:19px 0 0}nav a{flex-shrink:0;min-height:43px;padding:6px 0 11px;border-left:0;border-bottom:1px solid transparent;font-size:12px;gap:7px}nav a.active{border-left:0;border-bottom-color:var(--accent)}.nav-index{font-size:9px}.aside-foot{display:none}main{margin-left:0;padding:27px 22px 20px}header{gap:12px;padding-bottom:21px;align-items:flex-end}h2{font-size:30px;letter-spacing:1.5px;margin-top:6px}header .muted{font-size:10px;max-width:170px;display:block}.eyebrow{font-size:9px;letter-spacing:1.6px}.date-control{font-size:9px}input[type=date]{min-width:130px;max-width:145px;font-size:11px}.notice{font-size:10px;margin:16px 0 23px;gap:5px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:22px;margin-bottom:26px}.metric{min-height:150px;padding:21px 16px 20px 0!important}.metric:nth-child(even){padding-left:22px!important}.metric:nth-child(-n+4){border-bottom:1px solid var(--line)}.metric:nth-child(n+5){border-bottom:0}.metric:after{display:none}.metric:nth-child(odd):after{display:block;right:0;top:24px;bottom:24px}.metric h3{font-size:11px}.big{font-size:33px;gap:7px}.value-text{font-size:21px}.metric small{font-size:10px}.data-note{gap:7px}.data-note .note-body{min-width:200px}.card{padding:23px 0}h3{font-size:13px;margin-bottom:18px}svg{height:200px}.toolbar{gap:5px;margin:20px 0}.toolbar a{margin-left:0;width:100%}.toolbar button[data-range]{min-width:45px;padding:6px 9px}footer{font-size:9px}.footer-end{display:none}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style><aside><div class="brand-kicker">XIAOMI BAND</div><h1>\u65E5\u5E38\u8BB0\u5F55</h1><p class="brand-subtitle">\u4E2A\u4EBA\u5065\u5EB7\u6570\u636E\u6863\u6848</p><nav id="nav" aria-label="\u9875\u9762\u5BFC\u822A"></nav><div class="aside-foot"><span>\u5317\u4EAC\u65F6\u95F4 \xB7 Asia/Shanghai</span><span>\u6570\u636E\u6765\u81EA\u5C0F\u7C73\u8FD0\u52A8\u5065\u5EB7\u4E91\u7AEF</span><span class="privacy-label"><i class="privacy-dot" aria-hidden="true"></i>\u6240\u6709\u8005\u79C1\u6709</span></div></aside><main><header><div><div class="eyebrow">PERSONAL HEALTH JOURNAL</div><h2 id="title">\u4ECA\u65E5\u6982\u89C8</h2><span class="muted">\u7761\u7720\u3001\u5FC3\u7387\u4E0E\u6D3B\u52A8\u7684\u6BCF\u65E5\u8BB0\u5F55\u3002</span></div><label class="date-control">\u8BB0\u5F55\u65E5\u671F<input type="date" id="date" aria-label="\u8BB0\u5F55\u65E5\u671F"></label></header><div class="notice"><span>\u5C0F\u7C73\u4E91\u5DF2\u540C\u6B65\u8BB0\u5F55 \xB7 \u5317\u4EAC\u65F6\u95F4 \xB7 \u7F3A\u5931\u4E0D\u7B49\u4E8E\u96F6</span></div><div id="content">\u52A0\u8F7D\u4E2D\u2026</div><footer><a href="/settings-guide" title="Sites Settings">\u8FDE\u63A5\u4E0E\u914D\u7F6E</a><span>\xB7 \u51ED\u636E\u4EC5\u4FDD\u7559\u4E8E\u540E\u7AEF</span><span class="footer-end">\u65E5\u5E38\u8BB0\u5F55 / XIAOMI BAND</span></footer></main><script>
const $=s=>document.querySelector(s),names={overview:'\u4ECA\u65E5\u6982\u89C8',sleep:'\u7761\u7720\u5206\u6790',heart:'\u5FC3\u7387\u4E0E HRV',activity:'\u8FD0\u52A8\u5206\u6790',trends:'\u957F\u671F\u8D8B\u52BF',sync:'\u6570\u636E\u540C\u6B65\u7BA1\u7406',metrics:'\u5168\u90E8\u6307\u6807'};let range=7,filter='\u5168\u90E8',selectedMetric='spo2',metricCursor=null;
const cnDate=t=>new Date(t).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),add=(d,n)=>cnDate(Date.parse(d+'T00:00:00+08:00')+n*86400000),clock=t=>new Date(t*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),esc=v=>String(v??'\u2014').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=v=>v==null?'\u6682\u65E0\u6570\u636E':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
$('#date').value=cnDate(Date.now());$('#date').max=cnDate(Date.now());$('#date').onchange=()=>{metricCursor=null;render();};window.onhashchange=()=>{metricCursor=null;render();};
async function api(path){const r=await fetch(path,{cache:'no-store'}),b=await r.json();if(!r.ok)throw Error(b.error||'\u8BF7\u6C42\u5931\u8D25');return b;}
const card=(t,b)=>t==='\u6570\u636E\u65F6\u6548'?'<section class="data-note"><h3>\u8BB0\u5F55\u72B6\u6001</h3><div class="note-body">'+b+'</div></section>':'<section class="card"><h3>'+esc(t)+'</h3>'+b+'</section>',metric=(t,v,n)=>{const parts=String(v).match(/^([\\d,.]+)\\s+(.+)$/);return '<section class="metric"><h3>'+esc(t)+'</h3><div class="big">'+(parts?'<span>'+esc(parts[1])+'</span><span class="value-unit">'+esc(parts[2])+'</span>':'<span class="value-text">'+esc(v)+'</span>')+'</div><small>'+esc(n)+'</small></section>';};
function table(head,rows){return rows.length?'<table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<div class="empty">\u6B64\u8303\u56F4\u6682\u65E0\u5DF2\u540C\u6B65\u8BB0\u5F55</div>';}
function chart(points,unit){points=points.filter(p=>p.v!=null&&Number.isFinite(p.v));if(!points.length)return '<div class="empty">\u6CA1\u6709\u53EF\u7ED8\u5236\u7684\u771F\u5B9E\u6570\u636E</div>';const lo=Math.min(...points.map(p=>p.v)),hi=Math.max(...points.map(p=>p.v)),span=hi-lo||1,x=i=>48+i*664/Math.max(1,points.length-1),y=v=>190-(v-lo)/span*148;return '<div class="chart-wrap"><svg viewBox="0 0 760 240" role="img" aria-label="\u771F\u5B9E\u8BB0\u5F55\u66F2\u7EBF">'+[0,.5,1].map(f=>'<line class="chart-grid" x1="48" x2="712" y1="'+(190-f*148)+'" y2="'+(190-f*148)+'"/><text class="chart-axis" x="4" y="'+(194-f*148)+'">'+esc(fmt(lo+f*span))+'</text>').join('')+'<text class="chart-axis" x="48" y="20">'+esc(unit)+'</text><path class="chart-line" d="'+points.map((p,i)=>(i?'L':'M')+x(i)+','+y(p.v)).join(' ')+'"/>'+points.map((p,i)=>'<circle class="chart-point" cx="'+x(i)+'" cy="'+y(p.v)+'" r="4" tabindex="0"><title>'+esc(p.label+' \xB7 '+p.v+' '+unit)+'</title></circle>').join('')+'<text class="chart-axis" x="48" y="226">'+esc(points[0].label)+'</text><text class="chart-axis" x="712" y="226" text-anchor="end">'+esc(points.at(-1).label)+'</text></svg></div>';}

async function records(metric,start,end,cursor){return api('/api/records?metric='+encodeURIComponent(metric)+'&start='+start+'&end='+end+(cursor?'&cursor='+encodeURIComponent(cursor):''));}
async function render(){const p=names[location.hash.slice(1)]?location.hash.slice(1):'overview',date=$('#date').value;$('#nav').innerHTML=Object.entries(names).map(([k,v],i)=>'<a href="#'+k+'" '+(p===k?'aria-current="page" ':'')+'class="'+(p===k?'active':'')+'"><span class="nav-index">'+String(i+1).padStart(2,'0')+'</span><span>'+v+'</span></a>').join('');$('#title').textContent=names[p];$('#content').textContent='\u6B63\u5728\u8BFB\u53D6\u79C1\u6709\u6570\u636E\u5E93\u2026';try{
 if(p==='sync'){const s=await api('/api/sync-status');$('#content').innerHTML='<div class="toolbar"><button class="primary" id="sync-now">\u624B\u52A8\u589E\u91CF\u540C\u6B65</button><a href="/settings-guide">Secrets \u914D\u7F6E\u8BF4\u660E</a></div>'+card('\u540C\u6B65\u8FDB\u5EA6','<p>'+esc(s.job?(s.job.complete?'\u5F53\u524D\u4EFB\u52A1\u5DF2\u5B8C\u6210':'\u53EF\u65AD\u70B9\u7EED\u4F20')+' \xB7 '+s.job.start_date+' \u81F3 '+s.job.end_date:'\u5C1A\u672A\u5F00\u59CB')+'</p><small>\u6BCF\u6B21\u6700\u591A\u5904\u7406 12 \u9875\uFF1B\u4F18\u5148\u4ECA\u5929\u548C\u6628\u5929\uFF0C\u518D\u56DE\u586B\u8FC7\u53BB365\u5929\u3002\u591A\u6B21\u70B9\u51FB\u4F1A\u63A5\u7EED\u65AD\u70B9\u30022027 \u5E74\u524D\u590D\u6838\u6258\u7BA1\u8D39\u7528\uFF0C\u4E4B\u540E\u81EA\u52A8\u6682\u505C\u91C7\u96C6\u3002</small>')+card('\u5386\u53F2\u56DE\u586B',s.history?esc((s.history.complete?'\u8BA1\u5212\u5DF2\u904D\u5386':'\u6B63\u5728\u56DE\u586B')+' \xB7 \u76EE\u6807 '+s.history.start_date+' \u81F3 '+s.history.end_date+' \xB7 \u5F53\u524D '+s.history.current_date):'\u7B49\u5F85\u521D\u59CB\u5316')+card('\u5DF2\u5B58\u50A8\u8BB0\u5F55',table(['\u6307\u6807','\u8BB0\u5F55\u6570','\u6700\u65E9\u65E5\u671F','\u6700\u65B0\u65E5\u671F','\u5F85\u89E3\u6790'],s.counts.map(r=>[r.metric,r.records,r.first_date,r.latest_date,r.unparsed])))+card('\u540C\u6B65\u65E5\u5FD7',table(['\u5317\u4EAC\u65F6\u95F4','\u72B6\u6001','\u6307\u6807','\u65E5\u671F','\u6570\u91CF','\u9519\u8BEF\u7801'],s.logs.map(r=>[clock(r.at/1000),r.status,r.metric,r.date_cn,r.record_count,r.error_code])));$('#sync-now').onclick=async e=>{e.target.disabled=true;e.target.textContent='\u540C\u6B65\u4E2D\u2026';try{const r=await fetch('/api/sync',{method:'POST',headers:{'X-Site-Sync-Intent':'refresh'}});const b=await r.json();if(!r.ok)alert('\u540C\u6B65\u672A\u5B8C\u6210\uFF1A'+b.error);await render();}catch{alert('\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u5148\u67E5\u770B\u540C\u6B65\u65E5\u5FD7\uFF0C\u907F\u514D\u91CD\u590D\u53D1\u8D77');}};return;}
 if(p==='overview'){const [s,hr,sl,sp,steps,cal]=await Promise.all([api('/api/daily?date='+date),records('resting_heart_rate',date,date),records('sleep',date,date),records('sport',date,date),records('steps',date,date),records('calories',date,date)]);const h=hr.records.filter(x=>x.data).at(-1),sleep=sl.records.filter(x=>x.data).at(-1),sport=sp.records.filter(x=>x.data).at(-1);$('#content').innerHTML=card('\u6570\u636E\u65F6\u6548',s.day_status==='in_progress'?'\u4ECA\u5929\u5C1A\u672A\u7ED3\u675F\uFF0C\u4EE5\u4E0B\u662F\u5C0F\u7C73\u4E91\u5DF2\u4E0A\u4F20\u7684\u90E8\u5206\u6570\u636E\u3002\u6700\u540E\u5165\u5E93\uFF1A'+(s.summary?clock(s.summary.synced_at/1000):'\u5C1A\u672A\u540C\u6B65'):'\u8BE5\u65E5\u671F\u5DF2\u7ED3\u675F\uFF1B\u540E\u7EED\u4E0A\u4F20\u7684\u4FEE\u8BA2\u4ECD\u4F1A\u66F4\u65B0\u3002')+'<div class="grid">'+metric('\u7761\u7720\u8BB0\u5F55',s.metrics?.sleep?.main_sleep?fmt(s.metrics.sleep.main_sleep.time_asleep_minutes)+' \u5206\u949F':'\u6682\u65E0\u6570\u636E','\u4E3B\u8981\u7761\u7720\u6BB5\uFF1B\u5176\u4ED6\u7761\u7720\u5355\u72EC\u6C47\u603B')+metric('\u9759\u606F\u5FC3\u7387',s.summary?.resting_hr!=null?fmt(s.summary.resting_hr)+' bpm':'\u6682\u65E0\u6570\u636E','\u5F53\u65E5\u9759\u606F\u6837\u672C\u4E2D\u4F4D\u6570')+metric('\u7761\u7720 HRV \u6E90\u503C',s.hrv?.main_sleep?.has_positive_source_average?fmt(s.hrv.main_sleep.source_fields.avg_hrv)+(s.hrv.main_sleep.field_metadata?.avg_hrv?.unit==='ms'?' ms':''):'\u6682\u65E0\u6709\u6548\u6E90\u503C','\u5E73\u5747\u503C\u5355\u4F4D ms \xB7 \u6240\u6709\u8005 App \u5BF9\u8D26 \xB7 \u7B97\u6CD5\u672A\u9A8C\u8BC1')+metric('\u6B65\u6570',s.summary?.steps!=null?fmt(s.summary.steps)+' \u6B65':fmt(s.summary?.steps_record_count??null)+' \u6761\u660E\u7EC6',s.summary?.steps!=null?(s.metrics?.steps?.app_reconciled_for_date?'\u8BE5\u65E5\u671F\u5DF2\u4E0E App \u53C2\u8003\u503C\u6838\u5BF9':'\u4E91\u7AEF\u65E5\u62A5 \xB7 \u8BE5\u65E5\u671F\u672A\u4E0E App \u5BF9\u8D26'):'\u65E5\u603B\u6B65\u6570\u53E3\u5F84\u5F85\u6838\u5B9E')+metric('\u6D3B\u52A8\u6D88\u8017\u91C7\u6837',cal.records.filter(x=>x.data).length?fmt(cal.records.filter(x=>x.data).at(-1).data.active_kcal)+' kcal':'\u6682\u65E0\u6570\u636E','\u6700\u8FD1\u4E00\u6761\u91C7\u6837\uFF0C\u4E0D\u4F5C\u4E3A\u5F53\u65E5\u603B\u91CF')+metric('\u6700\u8FD1\u8FD0\u52A8',sport?({strength_training:'\u529B\u91CF\u8BAD\u7EC3',running:'\u8DD1\u6B65',cycling:'\u9A91\u884C',walking:'\u6B65\u884C',hiking:'\u5F92\u6B65'}[sport.data.activity_type]||sport.data.activity_type):'\u6682\u65E0\u6570\u636E',sport?fmt(sport.data.duration_minutes)+' \u5206\u949F':'\u5DF2\u540C\u6B65\u8303\u56F4\u5185\u65E0\u89E3\u6790\u8BB0\u5F55')+'</div>'+card('\u6B65\u6570\u8BB0\u5F55\u53D8\u5316 \xB7 \u660E\u7EC6\u503C\u5408\u8BA1 '+fmt(s.summary?.steps_sample_sum??null)+'\uFF08\u53E3\u5F84\u5F85\u6838\u5B9E\uFF09',chart(steps.records.filter(r=>r.data).map(r=>({label:clock(r.at),v:r.data.steps})),'\u6B65'))+card('\u6458\u8981\u8D28\u91CF',esc(s.quality?.status||'\u5F85\u6838\u5BF9')+'<p>'+esc((s.quality?.warnings||[]).join(' \xB7 '))+'</p><small>\u65E5\u5386\u5DF2\u7ED3\u675F\u4E0D\u4EE3\u8868\u4E91\u7AEF\u4E0A\u4F20\u5B8C\u6574\uFF1B\u8840\u6C27\u3001\u538B\u529B\u5747\u503C\u4EC5\u4EE3\u8868\u5DF2\u89C2\u6D4B\u6837\u672C\u3002</small>')+card('\u6570\u636E\u8986\u76D6',table(['\u6307\u6807','\u8BB0\u5F55\u6570','\u5DF2\u89E3\u6790'],s.counts.map(x=>[x.metric,x.records,x.parsed])))+'<div id="step-audit"></div>';const audit=await api('/api/steps-audit?start='+add(date,-6)+'&end='+date);$('#step-audit').innerHTML=card('\u6B65\u6570\u51C6\u786E\u6027\u6838\u5BF9',table(['\u65E5\u671F','\u624B\u673A\u53C2\u8003','\u4E91\u7AEF\u805A\u5408','\u6BCF\u5206\u949F\u53BB\u91CD','\u5168\u90E8\u6765\u6E90\u5408\u8BA1'],audit.checks.map(x=>[x.date,x.app_steps,x.cloud_daily_aggregate,x.minute_max_sum,x.raw_all_sources_sum])));return;}
 const start=add(date,-range+1);$('#content').innerHTML='<div class="toolbar">'+[1,7,30,90,365].map(n=>'<button data-range="'+n+'" '+(range===n?'class="primary"':'')+'>'+n+' \u5929</button>').join('')+'</div><div id="detail">\u52A0\u8F7D\u771F\u5B9E\u8BB0\u5F55\u2026</div>';document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{range=+b.dataset.range;metricCursor=null;render();});if(range>90&&p!=='trends'){$('#detail').innerHTML=card('\u67E5\u8BE2\u8303\u56F4','\u754C\u9762\u5DF2\u652F\u6301 365 \u5929\u9009\u9879\uFF1B\u4E3A\u9650\u5236\u5355\u6B21\u67E5\u8BE2\uFF0C\u672C\u7248\u9700\u8981\u5206\u6BB5\u67E5\u8BE2\uFF0C\u5F53\u524D\u5148\u9009\u62E9 90 \u5929\u4EE5\u5185\u3002\u4E0D\u4F1A\u4EE5\u6A21\u62DF\u8BB0\u5F55\u8865\u9F50\u3002');return;}
 if(p==='metrics'){const caps=await api('/api/metrics'),info=caps.metrics.find(x=>x.metric===selectedMetric)||caps.metrics[0],r=await records(info.metric,start,date,metricCursor),labels={data_available:'\u6709\u5B9E\u9645\u6570\u636E',schema_unverified:'\u539F\u59CB\u8BB0\u5F55\u5F85\u89E3\u6790',no_records_in_range:'\u67E5\u8BE2\u8303\u56F4\u65E0\u8BB0\u5F55',error:'\u8BF7\u6C42\u5931\u8D25',not_tested:'\u5F85\u540C\u6B65'};$('#detail').innerHTML=card('\u6240\u6709\u53C2\u8003\u6E20\u9053 \xB7 \u4EE5\u672C\u8D26\u53F7\u7ED3\u679C\u4E3A\u51C6',table(['\u6307\u6807','\u8BB0\u5F55\u6570','\u53EF\u89E3\u6790','\u8986\u76D6','\u72B6\u6001'],caps.metrics.map(x=>[x.label,x.records,x.parsed,x.first_date?x.first_date+' \u81F3 '+x.latest_date:'\u2014',labels[x.status]||x.status])))+'<div class="toolbar"><select id="metric-select">'+caps.metrics.map(x=>'<option value="'+x.metric+'" '+(x.metric===info.metric?'selected':'')+'>'+esc(x.label)+'</option>').join('')+'</select><button id="first-metric-page">\u7B2C\u4E00\u9875</button>'+(r.next_cursor?'<button id="next-metric-page">\u4E0B\u4E00\u9875</button>':'')+'</div>'+card(info.label+' \xB7 '+(info.unit||'\u539F\u59CB\u6570\u503C\uFF0C\u5355\u4F4D\u5F85\u6838\u5B9E'),chart(r.records.filter(x=>x.data&&info.field&&typeof x.data[info.field]==='number').map(x=>({label:clock(x.at),v:x.data[info.field]})),info.unit||'\u539F\u59CB\u503C'))+card('\u5F53\u524D\u9875 '+r.records.length+' \u6761'+(r.truncated?' \xB7 \u8FD8\u6709\u540E\u7EED\u9875':''),table(['\u65F6\u95F4','\u89E3\u6790\u72B6\u6001','\u8FD4\u56DE\u5B57\u6BB5'],r.records.map(x=>[clock(x.at),x.status,x.data?JSON.stringify(x.data):'\u539F\u59CB\u6570\u636E\u5DF2\u4FDD\u7559\uFF0C\u5F85\u9A8C\u8BC1\u7ED3\u6784'])));$('#metric-select').onchange=e=>{selectedMetric=e.target.value;metricCursor=null;render();};$('#first-metric-page').onclick=()=>{metricCursor=null;render();};if($('#next-metric-page'))$('#next-metric-page').onclick=()=>{metricCursor=r.next_cursor;render();};return;}
 if(p==='sleep'){const r=await records('sleep',start,date);$('#detail').innerHTML=card('\u7761\u7720\u65F6\u957F\u8D8B\u52BF',chart(r.records.filter(x=>x.data).map(x=>({label:x.date,v:x.data.duration_minutes})),'\u5206\u949F'))+card('\u7761\u7720\u8BB0\u5F55',table(['\u65E5\u671F','\u5165\u7761','\u8D77\u5E8A','\u7761\u7720\u5206\u949F','\u6DF1\u7761','\u6D45\u7761','REM','\u6E05\u9192','\u8D28\u91CF'],r.records.map(x=>[x.date,x.data?clock(x.data.start_at):'\u5F85\u89E3\u6790',x.data?clock(x.data.end_at):'\u5F85\u89E3\u6790',x.data?.time_asleep_minutes,x.data?.stage_minutes?.deep,x.data?.stage_minutes?.light,x.data?.stage_minutes?.rem,x.data?.time_awake_minutes,x.data?.quality?.status])));}
 else if(p==='heart'){const r=await records('heart_rate,resting_heart_rate',start,date);$('#detail').innerHTML=card('\u5FC3\u7387\u91C7\u6837\u66F2\u7EBF',chart(r.records.filter(x=>x.data).map(x=>({label:clock(x.at),v:x.data.bpm})),'bpm'))+card('\u6570\u636E\u8986\u76D6\u8BF4\u660E',(r.records.some(x=>x.metric==='heart_rate')?'\u5DF2\u8FD4\u56DE\u5168\u5929\u5FC3\u7387\u91C7\u6837\u3002':'\u5F53\u524D\u8303\u56F4\u672A\u8FD4\u56DE\u5168\u5929\u5FC3\u7387\uFF0C\u4EC5\u663E\u793A\u5DF2\u6709\u9759\u606F\u91C7\u6837\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u65AD\u8BBE\u5907\u4E0D\u652F\u6301\u3002')+' \u7761\u7720 HRV \u4FDD\u7559\u4E91\u7AEF\u539F\u59CB\u5B57\u6BB5\uFF1B\u5E73\u5747\u3001\u6700\u9AD8\u3001\u6700\u4F4E\u3001\u57FA\u51C6\u5355\u4F4D\u5DF2\u6309\u6240\u6709\u8005 App \u5BF9\u8D26\u4E3A ms\uFF1B\u5176\u4ED6\u5355\u4F4D\u4E0E\u7B97\u6CD5\u672A\u9A8C\u8BC1\u3002')+card('\u5FC3\u7387\u8BB0\u5F55',table(['\u65F6\u95F4','\u7C7B\u578B','\u5FC3\u7387'],r.records.slice(-150).map(x=>[clock(x.at),x.metric,x.data?.bpm])));const h=await api('/api/hrv?start='+start+'&end='+date);$('#detail').insertAdjacentHTML('beforeend',card('\u7761\u7720 HRV \xB7 \u4E91\u7AEF\u6E90\u503C',chart(h.records.filter(x=>x.has_positive_source_average).map(x=>({label:x.date,v:x.source_fields.avg_hrv})),'avg_hrv \xB7 ms\uFF08\u6240\u6709\u8005 App \u5BF9\u8D26\uFF09')+'<small>\u6BCF\u6761\u4E3A\u7761\u7720\u8BB0\u5F55\u7684\u6E90\u5B57\u6BB5\uFF0C\u4E0D\u662F\u9010\u70B9 HRV \u66F2\u7EBF\uFF1B\u7B97\u6CD5\u672A\u77E5\uFF0C\u96F6\u5360\u4F4D\u4E0D\u4F5C\u4E3A\u6709\u6548 HRV \u503C\u3002</small>')+card('HRV \u6E90\u5B57\u6BB5',table(['\u65E5\u671F','avg_hrv','min_hrv','max_hrv','hrv_median','\u6E90\u72B6\u6001','\u7761\u7720\u5B8C\u6574'],h.records.map(x=>[x.date,x.source_fields.avg_hrv,x.source_fields.min_hrv,x.source_fields.max_hrv,x.source_fields.hrv_median,x.status,x.source_complete===null?'\u672A\u77E5':x.source_complete?'\u662F':'\u5426'])))+(h.next_cursor?'<p class="muted">HRV \u8D85\u8FC7\u5F53\u524D\u9875\u4E0A\u9650\uFF0C\u8BF7\u7F29\u77ED\u8303\u56F4\u6216\u901A\u8FC7 MCP \u5206\u9875\u83B7\u53D6\u3002</p>':''));if(r.truncated)$('#detail').insertAdjacentHTML('beforeend','<p class="muted">\u8FBE\u5230 2,000 \u6761\u4E0A\u9650\uFF0C\u8BF7\u7F29\u77ED\u65E5\u671F\u8303\u56F4\u3002</p>');}
 else if(p==='activity'){const r=await records('sport',start,date);const types=[...new Set(r.records.map(x=>x.data?.activity_type).filter(Boolean))];$('#detail').innerHTML='<label>\u8FD0\u52A8\u7C7B\u578B <select id="activity-filter"><option>\u5168\u90E8</option>'+types.map(t=>'<option '+(filter===t?'selected':'')+'>'+esc(t)+'</option>').join('')+'</select></label>'+card('\u8FD0\u52A8\u8BB0\u5F55',table(['\u65E5\u671F','\u539F\u59CB\u7C7B\u578B','\u65F6\u957F\uFF08\u5206\u949F\uFF09','\u70ED\u91CF\uFF08kcal\uFF09','\u5E73\u5747\u5FC3\u7387'],r.records.filter(x=>filter==='\u5168\u90E8'||x.data?.activity_type===filter).map(x=>[x.date,x.data?.activity_type??'\u5F85\u89E3\u6790',x.data?.duration_minutes,x.data?.calories_kcal,x.data?.avg_heart_rate_bpm])));$('#detail').insertAdjacentHTML('beforeend',card('\u5355\u6B21\u8FD0\u52A8\u8BE6\u60C5',r.records.filter(x=>filter==='\u5168\u90E8'||x.data?.activity_type===filter).map(x=>'<p><button data-workout="'+esc(x.record_ref)+'">'+esc(clock(x.at))+' \xB7 \u67E5\u770B\u8BE6\u60C5</button></p>').join('')+'<div id="workout-detail"></div>'));document.querySelectorAll('[data-workout]').forEach(b=>b.onclick=async()=>{const d=await api('/api/activity-detail?ref='+encodeURIComponent(b.dataset.workout)+'&samples=true');$('#workout-detail').innerHTML=card('\u8FD0\u52A8\u6458\u8981',table(['\u5B57\u6BB5','\u4E91\u7AEF\u6570\u636E'],Object.entries(d.summary||{}).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v])))+card('\u9644\u52A0\u8FD0\u52A8\u6570\u636E \xB7 \u4FDD\u7559\u6E90\u5B57\u6BB5\u548C\u5355\u4F4D',table(['\u6E90\u5B57\u6BB5','\u6570\u503C','\u5355\u4F4D','\u53EF\u4FE1\u5EA6'],Object.entries(d.source_numeric_fields||{}).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):v,d.source_field_metadata?.[k]?.unit??'\u672A\u9A8C\u8BC1',d.source_field_metadata?.[k]?.confidence??'unverified'])))+card('\u8FD0\u52A8\u65F6\u95F4\u5185\u7684\u5168\u5929\u5FC3\u7387\u91C7\u6837',chart(d.heart_rate_samples.map(x=>({label:clock(x.at),v:x.bpm})),'bpm')+'<small>\u6309\u65F6\u95F4\u5173\u8054\u7684\u5168\u5929\u91C7\u6837\uFF0C\u4E0D\u4EE3\u8868\u539F\u751F\u8FD0\u52A8\u9AD8\u9891\u66F2\u7EBF\u3002</small>')+card('\u4E91\u7AEF\u9644\u52A0\u8BE6\u60C5 \xB7 '+d.operational_status,'<pre>'+esc(JSON.stringify(d.operational_data,null,2))+'</pre>');});$('#activity-filter').onchange=e=>{filter=e.target.value;render();};}
 else {const dates=Array.from({length:range},(_,i)=>add(start,i)),trend=await api('/api/trends?start='+start+'&end='+date),rows=dates.map(d=>({date:d,summary:trend.days.find(x=>x.date_cn===d)??null}));$('#detail').innerHTML=card('\u5DF2\u6838\u5BF9\u53E3\u5F84\u7684\u65E5\u6B65\u6570\u8D8B\u52BF',chart(rows.map(x=>({label:x.date,v:x.summary?.steps??null})),'\u6B65'))+card('\u65E5\u671F\u8986\u76D6\u65E5\u5386',table(['\u65E5\u671F','\u6B65\u6570\u8BB0\u5F55','\u65E5\u6B65\u6570','\u72B6\u6001'],rows.map(x=>[x.date,x.summary?.steps_record_count??'\u6682\u65E0',x.summary?.steps??'\u5F85\u6838\u5B9E',x.summary?.step_semantics??'\u672A\u540C\u6B65'])));}
 }catch(e){$('#content').textContent='\u8BFB\u53D6\u672A\u5B8C\u6210\uFF1A'+e.message;}}
render();<\/script></html>`;

// src/verification.ts
init_http();
init_parser();
function preflight(env) {
  return { mode: "private-account-verification", credentials: { MI_USER_ID: typeof env.MI_USER_ID === "string" && env.MI_USER_ID.length > 0, MI_PASS_TOKEN: typeof env.MI_PASS_TOKEN === "string" && env.MI_PASS_TOKEN.length > 0 }, liveValidationEnabled: env.MI_LIVE_VALIDATION_ENABLED === "true", timezone: "Asia/Shanghai", healthDataPersistence: false, automaticLogin: false, secretValuesReturned: false };
}
function previousDay(now) {
  return addDays(dateCN(Math.floor(now / 1e3)), -1);
}
async function validateOnce(env, transport = nativeFetcher(true), now = Date.now()) {
  if (env.MI_LIVE_VALIDATION_ENABLED !== "true") throw new CollectorError("USER_AUTHORIZATION_REQUIRED");
  if (!env.MI_USER_ID || !env.MI_PASS_TOKEN) throw new CollectorError("SECRETS_NOT_CONFIGURED");
  const date = previousDay(now);
  let accountCalls = 0, healthCalls = 0;
  const limited = async (url, init) => {
    if (new URL(url).hostname === "account.xiaomi.com" && ++accountCalls > 1) throw new CollectorError("LOGIN_ATTEMPT_LIMIT");
    if (new URL(url).hostname === "hlth.io.mi.com" && ++healthCalls > 6) throw new CollectorError("STEPS_REQUEST_LIMIT");
    return transport(url, init);
  };
  const adapter = new MiFitnessAdapter(limited, void 0, void 0, { totalWaitMs: 1500, maxWaitMs: 1e3 });
  await adapter.login(env.MI_USER_ID, env.MI_PASS_TOKEN);
  const samples = [], seen = /* @__PURE__ */ new Set(), cursors = /* @__PURE__ */ new Set();
  let cursor = null;
  for (let i = 0; i < 4; i++) {
    const page = await adapter.page("steps", date, date, cursor);
    for (const record of page.records) {
      const p = value(record), steps = p.steps;
      if (typeof steps !== "number" || !Number.isSafeInteger(steps) || steps < 0) throw new CollectorError("UNVERIFIED_STEPS_SCHEMA");
      const id = JSON.stringify([record.sid ?? "", record.time, steps]);
      if (!seen.has(id)) {
        seen.add(id);
        samples.push({ at: new Date(record.time * 1e3).toISOString(), steps });
      }
      if (samples.length > 1e3) throw new CollectorError("STEPS_RESULT_LIMIT");
    }
    if (!page.hasMore) return { authentication: "pass", metric: "steps", date, timezone: "Asia/Shanghai", source: "xiaomi_cloud", samples, recordCount: samples.length, dailyTotal: null, totalStatus: samples.length ? "AGGREGATION_SEMANTICS_NOT_YET_VERIFIED" : "NO_RECORDS_RETURNED", complete: true, persisted: false };
    if (!page.nextKey || cursors.has(page.nextKey)) throw new CollectorError("CURSOR_LOOP");
    cursors.add(page.nextKey);
    cursor = page.nextKey;
  }
  throw new CollectorError("PAGE_LIMIT_REACHED");
}

// src/worker.ts
init_http();
init_parser();
init_step_audit();
init_sleep_normalizer();
init_hrv_source();
var ui = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\u5C0F\u7C73\u4E91 \xB7 \u79C1\u6709\u8D26\u53F7\u9A8C\u8BC1</title><style>body{background:#0c1420;color:#e8eef6;font:16px system-ui;max-width:800px;margin:60px auto;padding:0 22px;line-height:1.8}article{border:1px solid #293c50;background:#121f2d;border-radius:16px;padding:24px;margin:24px 0}h1{font-size:28px}a{color:#8de2be}small,p{color:#b5c5d7}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:12px 20px;background:#8de2be;border:0;border-radius:8px;cursor:pointer}</style><h1>\u5C0F\u7C73\u4E91 \xB7 \u79C1\u6709\u8D26\u53F7\u9A8C\u8BC1</h1><p>\u72EC\u7ACB\u9A8C\u8BC1\u73AF\u5883 \xB7 \u5317\u4EAC\u65F6\u95F4 \xB7 \u4E0D\u4FDD\u5B58\u5065\u5EB7\u6570\u636E</p><article><h2>\u5148\u914D\u7F6E\uFF0C\u540E\u6388\u6743</h2><p>\u5728 <a href="https://chatgpt.com/sites" target="_blank" rel="noreferrer">Sites</a> \u4E2D\u627E\u5230\u201C\u5C0F\u7C73\u4E91 \xB7 \u79C1\u6709\u8D26\u53F7\u9A8C\u8BC1\u201D\uFF0C\u9009\u62E9\u66F4\u591A\u64CD\u4F5C \u2192 Settings\uFF0C\u5728\u6258\u7BA1\u73AF\u5883\u914D\u7F6E\u4E2D\u5206\u522B\u65B0\u589E MI_USER_ID\u3001MI_PASS_TOKEN\uFF0C\u5E76\u5C06\u4E24\u9879\u90FD\u8BBE\u4E3A Secret\u3002</p><p>\u8FD9\u91CC\u6CA1\u6709\u51ED\u636E\u8F93\u5165\u6846\u3002\u4E0D\u8981\u628A\u51ED\u636E\u53D1\u5230\u804A\u5929\u3001\u4E0A\u4F20\u6587\u4EF6\u6216\u5B58\u5165\u666E\u901A\u73AF\u5883\u53D8\u91CF\u3002\u4FDD\u5B58\u540E\u56DE\u5230\u5BF9\u8BDD\uFF0C\u53EA\u544A\u8BC9\u6211\u201C\u5DF2\u914D\u7F6E\u201D\u3002\u914D\u7F6E\u53D8\u66F4\u9700\u8981\u91CD\u65B0\u90E8\u7F72\u624D\u80FD\u751F\u6548\u3002</p></article><article><h2>\u5F53\u524D\u914D\u7F6E\u68C0\u67E5</h2><p>\u53EA\u68C0\u67E5\u662F\u5426\u914D\u7F6E\uFF0C\u4E0D\u663E\u793A\u4EFB\u4F55\u51ED\u636E\u503C\uFF0C\u4E5F\u4E0D\u8C03\u7528\u5C0F\u7C73\u3002</p><button id="check">\u68C0\u67E5\u914D\u7F6E\u72B6\u6001</button><pre id="result">\u5C1A\u672A\u68C0\u67E5</pre></article><article><h2>\u771F\u5B9E\u6D4B\u8BD5\u5C1A\u672A\u6388\u6743</h2><p>\u9875\u9762\u4E0D\u63D0\u4F9B\u771F\u5B9E\u6D4B\u8BD5\u6309\u94AE\u3002\u4F60\u660E\u786E\u6388\u6743\u540E\uFF0C\u7531\u540E\u7AEF\u6267\u884C\u4E00\u6B21 miothealth \u767B\u5F55\u53CA\u6700\u8FD1\u4E00\u4E2A\u5B8C\u6574\u81EA\u7136\u65E5\u7684\u6B65\u6570\u67E5\u8BE2\u3002\u4E0D\u4F1A\u5168\u91CF\u540C\u6B65\uFF0C\u4E0D\u8FDE\u63A5\u6570\u636E\u5E93\u3002\u8D26\u53F7\u8BA4\u8BC1\u51ED\u636E\u4EC5\u7528\u4E8E\u8BE5\u540E\u7AEF\u8BF7\u6C42\u3002</p><p>\u6B65\u6570\u8FD4\u56DE\u7ED3\u6784\u672A\u7ECF\u9A8C\u8BC1\u65F6\u4E0D\u64C5\u81EA\u5408\u8BA1\uFF0C\u4E0D\u628A\u7F3A\u5931\u8BB0\u5F55\u5F53\u4F5C\u96F6\u3002</p></article><script>document.querySelector('#check').onclick=async()=>{const out=document.querySelector('#result');try{const r=await fetch('/api/preflight',{cache:'no-store'});out.textContent=JSON.stringify(await r.json(),null,2);}catch{out.textContent='\u914D\u7F6E\u68C0\u67E5\u672A\u5B8C\u6210';}};<\/script></html>`;
var safeHeaders = { "Cache-Control": "no-store, private", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com; form-action 'none'; base-uri 'none'", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
async function serviceAuthorized(request, env) {
  const actual = request.headers.get("X-Verification-Service-Key"), expected = env.VERIFICATION_SERVICE_KEY;
  if (!actual || typeof expected !== "string" || !expected) return false;
  const enc = new TextEncoder(), a = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(actual))), b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(expected)));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
var worker_default = { async fetch(request, env) {
  const json = (v, status = 200) => Response.json(v, { status, headers: safeHeaders }), url = new URL(request.url);
  const visitor = !!(request.headers.get("oai-authenticated-user-id") || request.headers.get("oai-authenticated-user-email")), service = await serviceAuthorized(request, env), privateJob = request.headers.get("X-Site-Sync-Intent") === "refresh" && !request.headers.get("Origin");
  if (url.pathname === "/mcp" && request.method === "POST") {
    let body;
    try {
      if (Number(request.headers.get("Content-Length") ?? 0) > 16384) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      body = JSON.parse(await request.text());
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    if (!visitor && !service && !["server/discover", "tools/list", "initialize", "ping"].includes(String(body.method))) return json({ error: "SIGN_IN_REQUIRED" }, 401);
    return json(await rpc(env, body));
  }
  if (url.pathname === "/api/sync" && request.method === "POST") {
    if (request.headers.get("X-Site-Sync-Intent") !== "refresh") return json({ error: "SYNC_INTENT_REQUIRED" }, 403);
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
    if (url.search || await request.text()) return json({ error: "NO_SYNC_PARAMETERS" }, 400);
    try {
      return json(await runPersistentSync(env));
    } catch (e) {
      const code = e instanceof CollectorError && ["PERSIST_SYNC_DISABLED", "DATABASE_NOT_READY", "SECRETS_NOT_CONFIGURED", "SYNC_BUSY", "HOSTING_COST_REVIEW_REQUIRED"].includes(e.code) ? e.code : safeError(e);
      return json({ error: code }, 502);
    }
  }
  if (request.method === "GET" && url.pathname === "/api/sync-status" && request.headers.get("X-Site-Sync-Intent") === "refresh") {
    try {
      return json(await syncStatus(env));
    } catch {
      return json({ error: "DATABASE_NOT_READY" }, 503);
    }
  }
  if (!visitor && !service && !privateJob) return json({ error: "SIGN_IN_REQUIRED" }, 401);
  if (url.pathname === "/api/activity-raw-repair" && request.method === "POST") {
    if (!privateJob) return json({ error: "OPERATOR_AUTHORIZATION_REQUIRED" }, 403);
    try {
      const text2 = await request.text();
      if (url.search || text2.length > 512) return json({ error: "INVALID_ARGUMENTS" }, 400);
      const b = JSON.parse(text2);
      if (!b || Array.isArray(b) || Object.keys(b).length !== 1 || typeof b.record_ref !== "string") return json({ error: "INVALID_ARGUMENTS" }, 400);
      return json(await repairActivityRaw(env, b.record_ref));
    } catch (e) {
      return json({ error: e instanceof CollectorError && ["INVALID_RECORD_REF", "SYNC_BUSY_OR_NOT_INITIALIZED", "PERSIST_SYNC_DISABLED", "SECRETS_NOT_CONFIGURED", "HOSTING_COST_REVIEW_REQUIRED", "REPAIR_SOURCE_NOT_USABLE"].includes(e.code) ? e.code : "ACTIVITY_RAW_REPAIR_FAILED" }, 400);
    }
  }
  if (url.pathname === "/api/collection-window-audit" && request.method === "POST") {
    if (!privateJob) return json({ error: "OPERATOR_AUTHORIZATION_REQUIRED" }, 403);
    try {
      const text2 = await request.text();
      if (url.search || text2.length > 256) return json({ error: "INVALID_ARGUMENTS" }, 400);
      const b = JSON.parse(text2);
      if (!b || Array.isArray(b) || Object.keys(b).length !== 1 || typeof b.date !== "string") return json({ error: "INVALID_ARGUMENTS" }, 400);
      return json(await auditCollectionWindows(env, b.date));
    } catch (e) {
      return json({ error: e instanceof CollectorError && ["SYNC_BUSY_OR_NOT_INITIALIZED", "SECRETS_NOT_CONFIGURED", "HOSTING_COST_REVIEW_REQUIRED", "AUDIT_REQUIRES_CLOSED_WINDOWS", "INVALID_DATE"].includes(e.code) ? e.code : "WINDOW_AUDIT_FAILED" }, 400);
    }
  }
  if (request.method === "POST" && ["/api/steps-reference", "/api/steps-verify"].includes(url.pathname)) {
    if (!service && !privateJob) return json({ error: "OPERATOR_AUTHORIZATION_REQUIRED" }, 403);
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
    try {
      const body = await request.text();
      if (body.length > 8192) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      const b = JSON.parse(body);
      if (url.pathname === "/api/steps-reference") return json(await saveStepReferences(env, b.references));
      const r = validRange(b.start, b.end, 31);
      return json(await verifySteps(env, r.start, r.end));
    } catch {
      return json({ error: "INVALID_REFERENCE_OR_QUERY" }, 400);
    }
  }
  if (url.pathname === "/api/hrv-cloud-probe" && request.method === "POST" && privateJob) {
    if (request.headers.get("Origin")) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
    try {
      const raw = await request.text();
      if (raw.length > 256) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      const b = JSON.parse(raw);
      if (Object.keys(b).length !== 1 || typeof b.date !== "string") return json({ error: "INVALID_ARGUMENTS" }, 400);
      return json(await probeHRVCloud(env, b.date));
    } catch (e) {
      return json({ error: e instanceof CollectorError && ["SYNC_BUSY", "HRV_PROBE_BUSY", "SECRETS_NOT_CONFIGURED", "HOSTING_COST_REVIEW_REQUIRED"].includes(e.code) ? e.code : "HRV_PROBE_FAILED" }, 400);
    }
  }
  if (url.pathname === "/api/hrv-verification" && request.method === "POST" && (privateJob || service)) {
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
    try {
      const raw = await request.text();
      if (raw.length > 2048) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      return json(await saveHRVEvidence(env, JSON.parse(raw)));
    } catch (e) {
      return json({ error: e instanceof CollectorError && ["INVALID_HRV_REFERENCE", "HRV_REFERENCE_MISMATCH"].includes(e.code) ? e.code : "HRV_REFERENCE_FAILED" }, 400);
    }
  }
  if (url.pathname === "/api/quality-rebuild" && request.method === "POST" && privateJob) {
    try {
      const b = JSON.parse(await request.text());
      const r = validRange(b.start, b.end, 31);
      return json(await rebuildQuality(env, r.start, r.end));
    } catch {
      return json({ error: "QUALITY_REBUILD_FAILED" }, 502);
    }
  }
  if (url.pathname === "/api/mcp-trigger-sync" && request.method === "POST") {
    if (!privateJob && !visitor) return json({ error: "SIGN_IN_REQUIRED" }, 401);
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
    try {
      const body = await request.text();
      if (body.length > 1024) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      const b = body ? JSON.parse(body) : {};
      if (Object.keys(b).some((k) => !["sync_id", "retry_failed"].includes(k)) || b.sync_id !== void 0 && typeof b.sync_id !== "string" || b.retry_failed !== void 0 && typeof b.retry_failed !== "boolean") return json({ error: "INVALID_ARGUMENTS" }, 400);
      return json(await triggerSync(env, b.sync_id, void 0, void 0, b.retry_failed === true));
    } catch {
      return json({ error: "INVALID_SYNC_REQUEST" }, 400);
    }
  }
  if (url.pathname === "/api/activity-native-probe" && request.method === "POST" && privateJob) {
    try {
      const raw = await request.text();
      if (raw.length > 1024) return json({ error: "REQUEST_TOO_LARGE" }, 413);
      const b = JSON.parse(raw);
      if (Object.keys(b).some((k) => k !== "record_ref") || typeof b.record_ref !== "string") return json({ error: "INVALID_ARGUMENTS" }, 400);
      return json(await probeNativeWorkout(env, b.record_ref));
    } catch {
      return json({ error: "NATIVE_PROBE_FAILED" }, 502);
    }
  }
  if (request.method === "GET" && url.pathname === "/") return new Response(dashboard, { headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8" } });
  if (request.method === "GET" && url.pathname === "/settings-guide") return new Response(ui, { headers: { ...safeHeaders, "Content-Type": "text/html; charset=utf-8" } });
  if (request.method === "GET" && url.pathname === "/api/preflight") {
    if (url.search) return json({ error: "QUERY_PARAMETERS_NOT_ALLOWED" }, 400);
    return json({ ...preflight(env), healthDataPersistence: !!env.DB, databaseBound: !!env.DB, persistentSyncEnabled: env.PERSIST_SYNC_ENABLED === "true" });
  }
  if (request.method === "GET" && url.pathname.startsWith("/api/")) {
    try {
      if (url.pathname === "/api/activity-raw-repair") return json(await readActivityRawRepair(env, url.searchParams.get("ref") ?? ""));
      if (url.pathname === "/api/collection-window-audit") return json(await readWindowAudit(env, url.searchParams.get("date") ?? ""));
      if (url.pathname === "/api/raw-record") {
        try {
          return json(await rawRecord(env, url.searchParams.get("ref") ?? "", Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("limit") ?? 8192), url.searchParams.get("snapshot_hash") ?? void 0, url.searchParams.get("component") ?? void 0));
        } catch (e) {
          return json({ error: e instanceof CollectorError && rawReadErrors.has(e.code) ? e.code : "RAW_READ_FAILED" }, 400);
        }
      }
      if (url.pathname === "/api/data-coverage") {
        const r = validRange(url.searchParams.get("start"), url.searchParams.get("end"), 31);
        return json(await dataCoverage(env, r.start, r.end, url.searchParams.get("metric") ?? void 0));
      }
      if (url.pathname === "/api/steps-audit") {
        const r = validRange(url.searchParams.get("start"), url.searchParams.get("end"), 31);
        return json((await stepsAudit(env, r.start, r.end)).result);
      }
      if (url.pathname === "/api/activity-heart-rate-samples") return json(await activityHeartRateSamples(env, url.searchParams.get("ref") ?? "", Number(url.searchParams.get("offset") ?? 0), Number(url.searchParams.get("limit") ?? 1e3)));
      if (url.pathname === "/api/activity-heart-rate-analysis") return json(await activityHeartRateAnalysis(env, url.searchParams.get("ref") ?? ""));
      if (url.pathname === "/api/activity-detail") return json(await activityDetail(env, url.searchParams.get("ref") ?? "", url.searchParams.get("samples") === "true", Number(url.searchParams.get("limit") ?? 1e3)));
      if (url.pathname === "/api/hrv-source-evidence") {
        const r = validRange(url.searchParams.get("start"), url.searchParams.get("end"), 7);
        return json(await cachedHRVInspection(env, r.start, r.end));
      }
      if (url.pathname === "/api/quality-evidence") {
        const r = validRange(url.searchParams.get("start"), url.searchParams.get("end"), 7);
        return json(await qualityEvidence(env, r.start, r.end));
      }
      if (url.pathname === "/api/mcp-sync-progress") return json(await getSyncProgress(env, url.searchParams.get("sync_id") ?? void 0));
      if (url.pathname === "/api/metrics") return json(await availableMetrics(env));
      if (url.pathname === "/api/sync-status") return json(await syncStatus(env));
      if (url.pathname === "/api/trends") {
        const r = validRange(url.searchParams.get("start"), url.searchParams.get("end"), 366);
        if (!env.DB) return json({ error: "DATABASE_NOT_READY" }, 503);
        return json({ days: (await env.DB.prepare("SELECT * FROM daily_summary WHERE date_cn>=? AND date_cn<=? ORDER BY date_cn").bind(r.start, r.end).all()).results, timezone: "Asia/Shanghai" });
      }
      if (url.pathname === "/api/daily") return json(await daily(env, url.searchParams.get("date") ?? ""));
      if (url.pathname === "/api/hrv") {
        const range = validRange(url.searchParams.get("start"), url.searchParams.get("end"));
        return json(await hrvRecords(env, range.start, range.end, Number(url.searchParams.get("limit") ?? 2e3), url.searchParams.get("cursor") ?? void 0));
      }
      if (url.pathname === "/api/records") {
        const range = validRange(url.searchParams.get("start"), url.searchParams.get("end"));
        const metrics = (url.searchParams.get("metric") ?? "").split(",");
        if (!metrics.length || metrics.some((x) => !keys.includes(x))) return json({ error: "INVALID_METRIC" }, 400);
        return json(await queryRecords(env, metrics, range.start, range.end, Number(url.searchParams.get("limit") ?? 2e3), url.searchParams.get("cursor") ?? void 0));
      }
    } catch {
      return json({ error: "INVALID_QUERY_OR_DATABASE_UNAVAILABLE" }, 400);
    }
  }
  if (url.search) return json({ error: "QUERY_PARAMETERS_NOT_ALLOWED" }, 400);
  if (url.pathname !== "/api/validate-once") return json({ error: "NOT_FOUND" }, 404);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!service) return json({ error: "OPERATOR_AUTHORIZATION_REQUIRED" }, 403);
  if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "CROSS_ORIGIN_DENIED" }, 403);
  if (request.headers.get("X-Verification-Consent") !== "login-and-previous-day-steps") return json({ error: "EXPLICIT_CONSENT_REQUIRED" }, 403);
  if (request.headers.get("Content-Length") && request.headers.get("Content-Length") !== "0") return json({ error: "BODY_NOT_ALLOWED" }, 400);
  if (await request.text()) return json({ error: "BODY_NOT_ALLOWED" }, 400);
  try {
    return json(await validateOnce(env));
  } catch (e) {
    const allowed = /* @__PURE__ */ new Set(["USER_AUTHORIZATION_REQUIRED", "SECRETS_NOT_CONFIGURED", "INTERACTIVE_AUTH_REQUIRED", "LOGIN_REJECTED", "LOGIN_HTTP_ERROR", "STS_HTTP_ERROR", "SERVICE_TOKEN_MISSING", "AUTH_EXPIRED", "UPSTREAM_RETRY_DEFERRED", "UPSTREAM_RETRY_EXHAUSTED", "UNVERIFIED_STEPS_SCHEMA", "CURSOR_LOOP", "PAGE_LIMIT_REACHED", "STEPS_RESULT_LIMIT", "STEPS_REQUEST_LIMIT", "LOGIN_ATTEMPT_LIMIT", "LOGIN_FIELDS_MISSING", "LOGIN_SECURITY_EMPTY", "INVALID_LOGIN_PREFIX", "INVALID_LOGIN_JSON", "INVALID_LOGIN_RESPONSE"]);
    const code = e instanceof CollectorError && allowed.has(e.code) ? e.code : "VALIDATION_FAILED";
    return json({ error: code, ...e instanceof LoginDiagnosticError ? { diagnostics: e.diagnostics } : {} }, code === "USER_AUTHORIZATION_REQUIRED" ? 403 : 502);
  }
} };
export {
  MiFitnessAdapter,
  activityDetail,
  activityHeartRateAnalysis,
  allowedFDS,
  analyzeHR,
  attachHRVEvidence,
  auditCollectionWindows,
  availableMetrics,
  buildDaily,
  dataContract,
  dataCoverage,
  decodeStrengthV4,
  decryptFDS,
  worker_default as default,
  extractSleepHRV,
  fdsSuffix,
  fetchActivityDetails,
  fetchPendingNativeWorkout,
  fieldSemantics,
  getSyncProgress,
  inspectHRVTree,
  metricInfo,
  nativeSyncState,
  normalizeSleep,
  parseRecord,
  preflight,
  previousDay,
  probeHRVCloud,
  probeNativeWorkout,
  projectHealth,
  rawRecord,
  readActivityRawRepair,
  readWindowAudit,
  redactRawRecord,
  repairActivityRaw,
  rpc,
  runPersistentSync,
  saveHRVEvidence,
  saveRejectedRecords,
  saveStepReferences,
  sleepHRVFromRaw,
  stepsAudit,
  stripCredentials,
  toolCall,
  triggerSync,
  validateOnce,
  verifySteps
};
