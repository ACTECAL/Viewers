import React from 'react';
import type { IconProps } from '../types';

export const LoadingOHIFMark = (props: IconProps) => (
  <svg
    width="160"
    height="40"
    viewBox="0 0 160 40"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <defs>
      <linearGradient id="spectraGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3a3f99">
          <animate attributeName="stop-color" values="#3a3f99;#5b65d6;#3a3f99" dur="2s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stopColor="#5b65d6">
          <animate attributeName="stop-color" values="#5b65d6;#3a3f99;#5b65d6" dur="2s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
    </defs>
    <text
      x="50%"
      y="50%"
      dominantBaseline="middle"
      textAnchor="middle"
      fill="url(#spectraGradient)"
      fontSize="24"
      fontFamily="sans-serif"
      fontWeight="bold"
      letterSpacing="5"
    >
      SPECTRA
      <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" />
    </text>
  </svg>
);

export default LoadingOHIFMark;
