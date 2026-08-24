import type {
  BandSet,
  BlobRow,
  ClassifierVersion,
  ConfusionMatrix,
  DailyStatus,
  Dashboard,
  DisplayDetail,
  DisplaySample,
  Health,
  LotDetail,
  LotMeta,
  LotSample,
  LotSetup,
  LotSummary,
  SetupOptions,
  SetupValue,
  MaintenanceStatus,
  Message,
  Operator,
  Procedure,
  ProcedureSummary,
  ProcessId,
  ScanSummary,
  StampId,
  TestTypeId,
} from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Kan ikke få forbindelse til serveren. Kører backenden?",
      0,
    );
  }

  if (!response.ok) {
    let detail = `Serveren svarede ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* svaret var ikke JSON, behold standardteksten */
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  health: () => request<Health>("/health"),

  dashboard: () => request<Dashboard>("/dashboard"),

  operators: () => request<Operator[]>("/operators"),

  procedures: () => request<ProcedureSummary[]>("/procedures"),
  procedure: (id: string) => request<Procedure>(`/procedures/${id}`),

  daily: () => request<DailyStatus[]>("/daily"),
  completeDaily: (procedureId: string, doneBy: string) =>
    request<DailyStatus>(`/daily/${procedureId}/complete`, {
      method: "POST",
      body: JSON.stringify({ done_by: doneBy }),
    }),

  maintenance: () => request<MaintenanceStatus[]>("/maintenance"),
  completeMaintenance: (
    taskId: string,
    doneBy: string,
    doneAt?: string,
    note?: string,
  ) =>
    request<unknown>(`/maintenance/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({
        done_by: doneBy,
        note: note || null,
        done_at: doneAt || null,
      }),
    }),

  scans: () => request<ScanSummary[]>("/scans"),
  scan: (id: string) => request<ScanSummary>(`/scans/${encodeURIComponent(id)}`),
  scanBlobs: (
    id: string,
    opts: { limit?: number; predicted?: string; onlyCorrected?: boolean } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.predicted) q.set("predicted", opts.predicted);
    if (opts.onlyCorrected) q.set("only_corrected", "true");
    return request<BlobRow[]>(
      `/scans/${encodeURIComponent(id)}/blobs?${q.toString()}`,
    );
  },
  thumbnailUrl: (scanId: string, blobId: string) =>
    `/api/scans/${encodeURIComponent(scanId)}/blobs/${encodeURIComponent(blobId)}/thumbnail`,

  bands: (scanId: string, blobId: string) =>
    request<BandSet>(
      `/scans/${encodeURIComponent(scanId)}/blobs/${encodeURIComponent(blobId)}/bands`,
    ),
  bandUrl: (scanId: string, blobId: string, index: number) =>
    `/api/scans/${encodeURIComponent(scanId)}/blobs/${encodeURIComponent(blobId)}/band/${index}`,

  displaySamples: () => request<DisplaySample[]>("/display/samples"),
  displaySample: (id: string) =>
    request<DisplayDetail>(`/display/samples/${encodeURIComponent(id)}`),

  classifiers: () => request<ClassifierVersion[]>("/analysis/classifiers"),
  confusion: () => request<ConfusionMatrix>("/analysis/confusion"),

  lotMeta: () => request<LotMeta>("/lots/meta"),
  lots: () => request<LotSummary[]>("/lots"),
  lot: (lotNo: string) => request<LotDetail>(`/lots/${encodeURIComponent(lotNo)}`),
  createLot: (lot: {
    lot_no: string;
    variety?: string | null;
    item_no?: string | null;
    line?: string | null;
    started_by?: string | null;
  }) =>
    request<LotSummary>("/lots", { method: "POST", body: JSON.stringify(lot) }),
  createSample: (
    lotNo: string,
    sample: {
      process: ProcessId;
      test_type: TestTypeId;
      metrics: Record<string, number>;
      taken_by?: string | null;
      adjustment?: string | null;
      scan_id?: string | null;
    },
  ) =>
    request<LotSample>(`/lots/${encodeURIComponent(lotNo)}/samples`, {
      method: "POST",
      body: JSON.stringify(sample),
    }),
  sample: (sampleId: number) => request<LotSample>(`/lots/samples/${sampleId}`),
  acknowledgeSample: (sampleId: number, acknowledgedBy: string) =>
    request<LotSample>(`/lots/samples/${sampleId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
    }),
  stampLot: (
    lotNo: string,
    stamp: StampId,
    stampedBy: string,
    note?: string | null,
  ) =>
    request<LotSummary>(`/lots/${encodeURIComponent(lotNo)}/stamp`, {
      method: "POST",
      body: JSON.stringify({ stamp, stamped_by: stampedBy, note: note || null }),
    }),

  setupOptions: () => request<SetupOptions>("/lots/setup/options"),
  lotSetup: (lotNo: string) =>
    request<LotSetup>(`/lots/${encodeURIComponent(lotNo)}/setup`),
  saveLotSetup: (lotNo: string, setBy: string, values: SetupValue[]) =>
    request<LotSetup>(`/lots/${encodeURIComponent(lotNo)}/setup`, {
      method: "PUT",
      body: JSON.stringify({ set_by: setBy, values }),
    }),

  // Strømmen bærer ingen data, kun beskeden om at der er sket noget. Klienten
  // henter selv bagefter, så en skærm, der har været væk, ikke skal sy et hul
  // sammen af hændelser, den ikke fik.
  lotStreamUrl: () => "/api/lots/stream",

  currentMessage: () => request<Message | null>("/message"),
  messages: () => request<Message[]>("/messages"),
  postMessage: (body: string, author: string) =>
    request<Message>("/messages", {
      method: "POST",
      body: JSON.stringify({ body, author }),
    }),
  retractMessage: (id: number) =>
    request<void>(`/messages/${id}`, { method: "DELETE" }),
};

export { ApiError };
