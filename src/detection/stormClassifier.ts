import type { CloudDetectionResult, StormClassification, CloudType } from '../utils/types';

export function classifyStorm(detection: CloudDetectionResult): StormClassification {
  if (!detection || detection.cloudCount === 0)
    return { isStorm: false, stormScore: 0, cloudType: 'clear' };

  const cover = detection.cloudCoverRatio;
  const darkness = 1 - detection.meanBrightness / 255;
  let score = 0;
  if (cover > 0.15) score += Math.min(cover * 0.3, 0.3);
  if (darkness > 0.3) score += Math.min(darkness * 0.25, 0.25);
  if (detection.cloudCount > 3) score += Math.min(detection.cloudCount * 0.02, 0.15);
  score = Math.min(score, 1.0);

  const cloudType: CloudType =
    score > 0.55 && darkness > 0.35 ? 'cumulonimbus' :
    cover > 0.5 && darkness < 0.2 ? 'stratus' :
    score > 0.3 ? 'cumulus_congestus' :
    cover > 0.3 ? 'cumulus' :
    cover > 0.1 ? 'scattered' : 'clear';

  const isStorm = score >= 0.45;
  return {
    isStorm, stormScore: score, cloudType,
    alertMessage: isStorm ? `${score >= 0.7 ? 'SEVERE' : 'MODERATE'} STORM (${(score*100).toFixed(0)}%)` : undefined,
  };
}
