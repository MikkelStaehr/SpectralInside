export interface Step {
  index: number;
  title: string;
  body: string;
  wait_seconds: number | null;
}

export interface ProcedureSummary {
  id: string;
  title: string;
  lead: string;
  order: number;
  trigger: string | null;
  duration: string | null;
  icon: string | null;
  category: "wiki" | "vedligehold";
  daily: boolean;
  step_count: number;
  updated_at: string;
}

export interface Procedure extends ProcedureSummary {
  intro: string;
  steps: Step[];
}

export type MaintenanceState =
  | "ok"
  | "due_soon"
  | "overdue"
  | "never"
  | "event_driven";

export interface MaintenanceTask {
  id: string;
  title: string;
  interval_days: number | null;
  warn_days: number | null;
  procedure: string | null;
  why: string;
  note: string | null;
  also_when: string[];
}

export interface MaintenanceStatus {
  task: MaintenanceTask;
  state: MaintenanceState;
  last_done_at: string | null;
  last_done_by: string | null;
  due_at: string | null;
  days_until_due: number | null;
}

export interface Message {
  id: number;
  body: string;
  author: string;
  created_at: string;
}

export interface DailyStatus {
  procedure_id: string;
  title: string;
  day: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
}

export interface Operator {
  initials: string;
  name: string | null;
  role: "analytiker" | "udvikler";
}

export interface ClassCount {
  name: string;
  count: number;
}

export interface ScanCounts {
  yesterday: number;
  today: number;
  last_7_days: number;
}

export interface RecentScan {
  id: string;
  recipe: string | null;
  sample: string | null;
  operator: string | null;
  scanned_on: string | null;
  blob_count: number;
}

export interface MaintenanceReminder {
  overdue: number;
  due_soon: number;
  never: number;
  titles: string[];
}

export interface Dashboard {
  message: Message | null;
  reminder: MaintenanceReminder;
  scans: ScanCounts;
  recent: RecentScan[];
}

export interface ScanSummary {
  id: string;
  filename: string;
  recipe: string | null;
  sample: string | null;
  operator: string | null;
  scanned_on: string | null;
  blob_count: number;
  labelled_count: number;
  unknown_count: number;
  unknown_share: number;
  classes: ClassCount[];
  classifier: string | null;
  size_bytes: number;
  modified_at: string | null;
}

export interface BlobRow {
  blob_id: string;
  predicted: string | null;
  reference: string | null;
  confidence: number | null;
  corrected: boolean;
}

export interface Band {
  index: number;
  wavelength: number | null;
  label: string;
}

export interface BandSet {
  blob_id: string;
  count: number;
  bands: Band[];
  note: string;
}

export interface ClassifierVersion {
  name: string;
  version: string | null;
  filename: string;
  classes: string[];
  size_bytes: number;
  modified_at: string;
}

export interface DisplaySample {
  id: string;
  sample: string | null;
  analyst: string | null;
  scanned_on: string | null;
  total_seeds: number;
  focus_count: number;
  focus_share: number;
  unplaced_count: number;
}

export interface DisplayDetail extends DisplaySample {
  focus_class: string;
  focus_label: string;
  blobs: BlobRow[];
}

export interface ConfusionCell {
  reference: string;
  predicted: string;
  count: number;
}

export interface ConfusionMatrix {
  labels: string[];
  cells: ConfusionCell[];
  total: number;
  correct: number;
  scans_included: number;
  note: string;
}

// --- Lots og prøver --------------------------------------------------------
//
// Operatørskærmen i produktionen. Bemærk at hverken processernes rækkefølge,
// metrikkernes navne eller hvilken vej der er den gode står her: det kommer
// fra /api/lots/meta, så det kun findes ét sted.

export type ProcessId = "pre_cleaning" | "cleaning" | "post_cleaning";
export type TestTypeId = "purity" | "cleaning_damage";
export type StampId = "approved" | "rejected";

export interface Metric {
  id: string;
  label: string;
  unit: string;
  primary: boolean;
  better: "higher" | "lower";
  /** Klassens navn i VideometerLabs egen model. Null for metrikker uden klasse. */
  source_class: string | null;
}

// Opsætningen af linjen. Hvilke indstillinger der findes, kommer fra
// content/machine-setup.yaml gennem serveren, så listen kan rettes uden
// en kodeændring.

export interface SetupSetting {
  id: string;
  label: string;
  type: "number" | "text" | "choice";
  unit: string | null;
  options: string[];
  hint: string | null;
}

export interface SetupGroup {
  id: string;
  title: string;
  lead: string;
  settings: SetupSetting[];
}

export interface SetupOptions {
  groups: SetupGroup[];
}

export interface SetupValue {
  setting_id: string;
  value: string;
}

export interface LotSetup {
  lot_no: string;
  values: SetupValue[];
  set_at: string | null;
  set_by: string | null;
}

export interface TestType {
  id: TestTypeId;
  label: string;
  metrics: Metric[];
}

export interface Process {
  id: ProcessId;
  step: number;
  label: string;
  test_types: TestTypeId[];
  stamp: boolean;
}

export interface LotMeta {
  processes: Process[];
  test_types: TestType[];
  flat_threshold: number;
  relative_threshold: number;
}

export interface LotSample {
  id: number;
  lot_no: string;
  process: ProcessId;
  test_type: TestTypeId;
  seq: number;
  taken_at: string;
  taken_by: string | null;
  adjustment: string | null;
  scan_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  metrics: Record<string, number>;
}

export interface LotSummary {
  lot_no: string;
  variety: string | null;
  /** Varenummeret paa sorten. Noeglen der bruges uden for laboratoriet. */
  item_no: string | null;
  line: string | null;
  started_at: string;
  started_by: string | null;
  stamp: StampId | null;
  stamped_at: string | null;
  stamped_by: string | null;
  stamp_note: string | null;
  sample_count: number;
  unacknowledged_count: number;
  last_sample_at: string | null;
  /** Sidst der skete noget: en prøve, et stempel, en opsætning, eller starten. */
  last_activity: string | null;
}

export interface LotDetail extends LotSummary {
  samples: LotSample[];
}

export interface Health {
  status: "ok" | "degraded";
  version: string;
  content_dir: string;
  procedures_found: number;
  problems: string[];
}
