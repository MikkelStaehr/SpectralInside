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
export type TestTypeId = "purity" | "cleaning_damage" | "ct";
export type StampId = "approved" | "rejected";

/**
 * En fordeling inden for en testtype. En CT-scanning giver to af én måling:
 * de seks klasser og de fire FV-trin.
 *
 * `scale` afgør, hvordan gruppen tegnes. Nominal betyder at klasserne ikke har
 * nogen indbyrdes rækkefølge, og så er de søjler på en fælles akse. Ordinal
 * betyder at de er ordnede, FV1 er dårligere end FV0, og så er de én stablet
 * søjle i én kulør fra lys til mørk.
 */
export interface MetricGroup {
  id: string;
  label: string;
  lead: string;
  scale: "nominal" | "ordinal";
}

export interface Metric {
  id: string;
  label: string;
  unit: string;
  primary: boolean;
  better: "higher" | "lower";
  /** Klassens navn i instrumentets egen model. Null for metrikker uden klasse. */
  source_class: string | null;
  /** Hvilken fordeling metrikken hører til. Null når testtypen kun har én. */
  group: string | null;
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
  lead: string;
  metrics: Metric[];
  groups: MetricGroup[];
}

export interface Process {
  id: ProcessId;
  step: number;
  label: string;
  test_types: TestTypeId[];
  stamp: boolean;
}

/**
 * Ét stamdatafelt paa et lot.
 *
 * Listen kommer fra serveren, saa formularen kan tegnes uden at frontenden
 * kender feltnavnene. Raekkefoelgen er driftsrapportens egen: operatoeren
 * udfylder i dag det samme skema i haanden, og en anden raekkefoelge paa
 * skaermen ville goere to opgaver ud af én.
 */
export interface LotField {
  id: string;
  label: string;
  type: "text" | "number" | "datetime";
  unit: string | null;
  hint: string | null;
  /** Skal vaere udfyldt, foer lottet er fuldstaendigt. Spaerrer ikke oprettelsen. */
  required: boolean;
  /** Saettes af systemet. Vises, men kan ikke rettes. */
  readonly: boolean;
}

export interface LotMeta {
  processes: Process[];
  test_types: TestType[];
  lot_fields: LotField[];
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
  /** Stamdata fra driftsrapportens "Ordre"-blok. */
  order_no: string | null;
  report_no: string | null;
  input_kg: number | null;
  ended_at: string | null;
  note: string | null;
  /**
   * Paakraevede stamdatafelter, der endnu er tomme. En huskeliste og ikke en
   * spaerring: kg ind kendes foerst, naar partiet er koert igennem.
   */
  missing: string[];
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
