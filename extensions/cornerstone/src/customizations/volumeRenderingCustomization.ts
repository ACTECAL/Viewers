import { CONSTANTS } from '@cornerstonejs/core';
import { osirixPresets } from '../utils/osirixPresets';

const { VIEWPORT_PRESETS } = CONSTANTS;

export default {
  'cornerstone.3dVolumeRendering': {
    volumeRenderingPresets: [...osirixPresets, ...VIEWPORT_PRESETS],
    volumeRenderingQualityRange: {
      min: 1,
      max: 4,
      step: 1,
    },
  },
};
