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

export interface Health {
  status: "ok" | "degraded";
  version: string;
  content_dir: string;
  procedures_found: number;
  problems: string[];
}
