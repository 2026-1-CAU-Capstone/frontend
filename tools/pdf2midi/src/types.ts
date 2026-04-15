export type Quality = "ok" | "suspicious" | "failed";

export type PipelineStage =
  | "scan"
  | "audiveris"
  | "mscore_midi"
  | "mscore_audio"
  | "validate"
  | "meta";

export interface ToolVersions {
  audiveris: string | null;
  mscore: string | null;
}

export interface ConvertOptions {
  inputPdf: string;
  outputDir: string;
  tmpDir: string;
  audio: boolean;
  audiverisTimeoutMs: number;
  mscoreTimeoutMs: number;
  force: boolean;
  versions: ToolVersions;
}

export interface ValidationStats {
  midiBytes: number;
  midiNoteCount: number;
  durationSeconds: number;
  measureCount: number;
  harmonyCount: number;
  partCount: number;
}

export interface ValidationResult {
  quality: Quality;
  stats: ValidationStats;
  warnings: string[];
}

export interface ConvertResultMeta {
  source: string;
  source_abs: string;
  slug: string;
  output_dir: string;
  midi_path: string;
  mxl_path: string;
  audio_path: string | null;
  converted_at: string;
  audiveris_version: string | null;
  mscore_version: string | null;
  duration_seconds: number;
  midi_note_count: number;
  measure_count: number;
  harmony_count: number;
  part_count: number;
  warnings: string[];
  quality: Quality;
}

export type ConvertOutcome =
  | {
      kind: "success";
      meta: ConvertResultMeta;
    }
  | {
      kind: "skipped";
      source: string;
      reason: string;
    }
  | {
      kind: "failure";
      source: string;
      stage: PipelineStage;
      error: string;
      stderr_tail: string;
    };

export interface FailureRecord {
  source: string;
  stage: PipelineStage;
  error: string;
  stderr_tail: string;
}
