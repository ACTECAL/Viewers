import React from 'react';
import type { IconProps } from '../types';

export const LoadingOHIFMark = (props: IconProps) => (
  <svg
    width="100"
    height="120"
    viewBox="0 0 100 120"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="15" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.8">
      <animate attributeName="y" values="40; 10; 40" dur="1.2s" begin="0s" repeatCount="indefinite" />
      <animate attributeName="height" values="20; 80; 20" dur="1.2s" begin="0s" repeatCount="indefinite" />
    </rect>
    <rect x="35" y="40" width="10" height="20" rx="5" fill="#0D6EFD">
      <animate attributeName="y" values="40; 10; 40" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
      <animate attributeName="height" values="20; 80; 20" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
    </rect>
    <rect x="55" y="40" width="10" height="20" rx="5" fill="#0D6EFD">
      <animate attributeName="y" values="40; 10; 40" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
      <animate attributeName="height" values="20; 80; 20" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
    </rect>
    <rect x="75" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.8">
      <animate attributeName="y" values="40; 10; 40" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
      <animate attributeName="height" values="20; 80; 20" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
    </rect>
    <text x="50" y="115" textAnchor="middle" fill="#0D6EFD" fontSize="16" fontFamily="sans-serif" fontWeight="bold" letterSpacing="2">
      SPECTRA
    </text>
  </svg>
);

export default LoadingOHIFMark;
