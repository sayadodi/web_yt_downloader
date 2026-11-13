export type QualityOption = {
  id: string;
  label: string;
  kbps: number;
  sizeMB: number;
  available: boolean;
  reason: string | null;
};

export type VideoInfoResponse = {
  id: string;
  title: string;
  uploader: string;
  duration: number;
  durationLabel: string;
  thumbnail: string;
  sourceBitrate: number | null;
  tooLong: boolean;
  maxDuration: number;
  qualities: QualityOption[];
};

export type ApiErrorPayload = {
  error?: string;
  code?: string;
};
