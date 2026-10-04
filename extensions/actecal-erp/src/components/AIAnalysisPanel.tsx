import React from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';

import { getActiveViewportInfo } from '../utils/captureActiveViewport';
import { AI_COLOR } from '../utils/measurementColors';
import { useDicomAiAnalysis } from '../hooks/useDicomAiAnalysis';

const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSUFFICIENT: 'insufficient',
  SUCCESS: 'success',
  ERROR: 'error',
};

const SEVERITY_TONE = {
  high: 'bg-red-900/60 text-red-100 border-red-600',
  medium: 'bg-orange-900/60 text-orange-100 border-orange-600',
  low: 'bg-yellow-900/60 text-yellow-100 border-yellow-600',
};

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch (error) {
    return iso || '';
  }
}

function MeasurementRow({ measurement }) {
  return (
    <li className="bg-secondary-dark flex items-start gap-2 rounded border border-cyan-700/60 p-2">
      <span
        className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: AI_COLOR }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm font-semibold text-cyan-100">{measurement.label}</span>
          <span className="rounded bg-cyan-900/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100">
            AI
          </span>
          {measurement.severity && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                SEVERITY_TONE[String(measurement.severity).toLowerCase()] ||
                'border-gray-500 bg-gray-700 text-gray-100'
              }`}
            >
              {measurement.severity}
            </span>
          )}
        </div>
        {measurement.measurementText && (
          <p className="text-sm text-white">{measurement.measurementText}</p>
        )}
        <p className="text-xs text-gray-300">
          {measurement.location ? `${measurement.location} · ` : ''}
          {measurement.toolType === 'Bidirectional' ? 'Bidirectional' : 'Length'}
          {measurement.sliceIndex != null ? ` · slice ${measurement.sliceIndex}` : ''}
          {measurement.confidence != null ? ` · confidence ${measurement.confidence}` : ''}
        </p>
      </div>
    </li>
  );
}

MeasurementRow.propTypes = {
  measurement: PropTypes.shape({
    label: PropTypes.string,
    measurementText: PropTypes.string,
    location: PropTypes.string,
    severity: PropTypes.string,
    confidence: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    sliceIndex: PropTypes.number,
    toolType: PropTypes.string,
  }).isRequired,
};

function AIAnalysisPanel() {
  const { servicesManager, extensionManager } = useSystem();
  const { status, errorMessage, result, aiMeasurements, credit, originalImage, runAnalysis } =
    useDicomAiAnalysis({
      servicesManager,
      extensionManager,
    });

  const [hasStudy, setHasStudy] = React.useState(false);

  // Track the currently open study/viewport so analysis always targets whatever
  // the user has open at the moment they click.
  React.useEffect(() => {
    const refreshActiveStudy = () => {
      const info = getActiveViewportInfo(servicesManager);
      setHasStudy(!!(info.studyInstanceUid && info.viewport));
    };

    refreshActiveStudy();
    const viewportGridService = servicesManager.services.viewportGridService;

    if (viewportGridService && viewportGridService.subscribe) {
      const subscriptions = Object.values(viewportGridService.EVENTS || {}).map(event =>
        viewportGridService.subscribe(event, refreshActiveStudy)
      );
      return () => {
        subscriptions.forEach(subscription => subscription && subscription.unsubscribe());
      };
    }
    return undefined;
  }, [servicesManager]);

  const isLoading = status === STATUS.LOADING;

  return (
    <div className="bg-primary-dark relative flex h-full flex-col p-2 text-white">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="whitespace-nowrap text-lg font-bold">AI Analysis</h3>
          {credit !== null && credit !== undefined && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                credit > 0 ? 'bg-green-800 text-green-100' : 'bg-red-900 text-red-100'
              }`}
            >
              {credit} credits
            </span>
          )}
        </div>
        <button
          className="bg-primary-main hover:bg-primary-light rounded py-1 px-3 text-xs font-bold text-white disabled:opacity-50"
          onClick={runAnalysis}
          disabled={isLoading || !hasStudy}
        >
          {isLoading ? 'Analyzing…' : 'Run AI Analysis'}
        </button>
      </div>

      <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-300">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: AI_COLOR }}
          aria-hidden="true"
        />
        AI findings are drawn on the image in cyan, separately from each doctor&apos;s measurements.
      </p>

      {!hasStudy && status === STATUS.IDLE && (
        <div className="mb-14 p-2 text-sm text-gray-300">
          Open a study and click <b>Run AI Analysis</b> to send the currently displayed slice to the
          GPU vision endpoint.
        </div>
      )}

      {isLoading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-gray-200">
          <div className="border-primary-light h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
          <p className="text-center text-sm">
            Retrieving the DICOM instance and analyzing it on the GPU…
          </p>
        </div>
      )}

      {status === STATUS.INSUFFICIENT && (
        <div className="bg-secondary-dark mb-14 flex-1 overflow-auto rounded border border-amber-600 p-3 text-amber-200">
          <p className="mb-1 font-bold">Insufficient AI credits</p>
          <p className="text-sm">
            Your account does not have enough AI balance to run this analysis. Please contact your
            administrator to add AI credits.
          </p>
          {credit !== null && credit !== undefined && (
            <p className="mt-2 text-xs">Available AI credits: {credit}</p>
          )}
        </div>
      )}

      {status === STATUS.ERROR && (
        <div className="bg-secondary-dark mb-14 flex-1 overflow-auto rounded border border-red-600 p-3 text-red-200">
          <p className="mb-1 font-bold">Analysis failed</p>
          <p className="break-words text-sm">{errorMessage}</p>
        </div>
      )}

      {status === STATUS.SUCCESS && (
        <div className="mb-16 flex min-h-0 w-full flex-1 flex-col overflow-auto">
          {originalImage && (
            <img
              src={originalImage}
              alt="Analyzed slice"
              className="border-secondary-light mb-2 w-full rounded border"
            />
          )}

          <div className="bg-secondary-dark border-secondary-light rounded border p-2 text-white">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-gray-300">{result?.model || 'GPU Vision'}</span>
              <span className="flex items-center gap-1.5">
                {result?.latencySec != null && (
                  <span className="text-xs text-gray-400">
                    {Number(result.latencySec).toFixed(1)}s
                  </span>
                )}
                {result && !result.usedDicomFile && (
                  <span
                    className="rounded border border-amber-600 bg-amber-900/50 px-2 py-0.5 text-xs font-semibold text-amber-100"
                    title="The PACS would not release the raw instance, so the rendered viewport image was analyzed instead."
                  >
                    Rendered image
                  </span>
                )}
              </span>
            </div>

            {result?.findings && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-cyan-300">
                  Findings
                </p>
                <p className="text-sm text-gray-100">{result.findings}</p>
              </div>
            )}

            {result?.impression && result.impression !== result.findings && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-cyan-300">
                  Impression
                </p>
                <p className="text-sm text-gray-100">{result.impression}</p>
              </div>
            )}

            {aiMeasurements.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-cyan-300">
                  AI Measurements ({aiMeasurements.length})
                </p>
                <ul className="flex flex-col gap-1">
                  {aiMeasurements.map(measurement => (
                    <MeasurementRow
                      key={measurement.uid}
                      measurement={measurement}
                    />
                  ))}
                </ul>
              </div>
            )}

            {aiMeasurements.length === 0 && (
              <p className="text-sm text-gray-200">
                No measurements to draw on this slice — the narrative above is the full result.
              </p>
            )}
          </div>

          <div className="mt-2 rounded border border-green-700 bg-green-900/40 p-2 text-green-100">
            <p className="mb-1 text-xs font-bold">✓ AI-Reviewed — this slice was analyzed by AI</p>
            <p className="text-xs">
              Model <b>{result?.model}</b> reviewed the displayed slice on{' '}
              <b>{formatTimestamp(result?.analyzedAt)}</b>.{' '}
              {aiMeasurements.length > 0
                ? 'The cyan calipers above are preliminary findings only and do not replace a radiologist’s final report.'
                : 'This is preliminary output only and does not replace a radiologist’s final report.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// servicesManager / extensionManager come from useSystem(), not from props, so
// they are deliberately absent here: declaring them as required props would
// warn on every render.
AIAnalysisPanel.propTypes = {};

export default AIAnalysisPanel;
