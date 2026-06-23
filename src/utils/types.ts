export interface CloudDetectionResult {
  cloudMask: number[][];
  cloudCount: number;
  cloudCoverRatio: number;
  meanBrightness: number;
  dominantColor: [number, number, number];
  timestamp: number;
}

export interface StormClassification {
  isStorm: boolean;
  stormScore: number;
  cloudType: CloudType;
  alertMessage?: string;
}

export type CloudType =
  | 'clear' | 'scattered' | 'cumulus'
  | 'cumulus_congestus' | 'stratus' | 'cumulonimbus';

export interface MotionData {
  averageDx: number;
  averageDy: number;
  magnitude: number;
  direction: number;
}

export interface TrackedCloud {
  id: number;
  positions: [number, number][];
  age: number;
  isActive: boolean;
  predictedPosition?: [number, number];
}

export interface FrameResult {
  frameNumber: number;
  detection: CloudDetectionResult | null;
  storm: StormClassification | null;
  motion: MotionData | null;
  trackedClouds: TrackedCloud[];
}
