import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';
import ApiService from '../services/ApiService';
import { getAiConfig, runAiAnalysis } from '../services/AiService';
import { captureActiveViewport, getActiveViewportInfo } from '../utils/captureActiveViewport';
import drawMarkingsOnImage from '../utils/drawMarkingsOnImage';

const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  INSUFFICIENT: 'insufficient',
  SUCCESS: 'success',
  ERROR: 'error',
};

function AIAnalysisPanel() {
  const { servicesManager } = useSystem();
  const aiConfig = getAiConfig();

  const [availableModels] = useState(
    aiConfig.models && aiConfig.models.length
      ? aiConfig.models
      : [aiConfig.model || aiConfig.defaultModel || 'gemini-2.5-flash']
  );
  const [model, setModel] = useState(aiConfig.defaultModel || aiConfig.model);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);
  const [markedImage, setMarkedImage] = useState(null);
  const [originalImage, setOriginalImage] = useState(null);
  const [showMarked, setShowMarked] = useState(true);
  const [credit, setCredit] = useState(null);
  const [hasStudy, setHasStudy] = useState(false);

  const refreshActiveStudy = useCallback(() => {
    const info = getActiveViewportInfo(servicesManager);
    setHasStudy(!!(info.studyInstanceUid && info.viewport));
  }, [servicesManager]);

  // Track the currently open study/viewport so analysis always targets
  // whatever the user has open at the moment they click.
  useEffect(() => {
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
  }, [servicesManager, refreshActiveStudy]);

  // Show the available AI credit in the panel header.
  useEffect(() => {
    new ApiService()
      .getAiCredits()
      .then(credits => setCredit(credits.available))
      .catch(() => setCredit(null));
  }, []);

  const handleRunAnalysis = async () => {
    setStatus(STATUS.LOADING);
    setErrorMessage('');
    setResult(null);
    setMarkedImage(null);
    setOriginalImage(null);

    try {
      const info = getActiveViewportInfo(servicesManager);
      if (!info.studyInstanceUid || !info.viewport) {
        setStatus(STATUS.ERROR);
        setErrorMessage('No active image is open to analyze. Open a study first.');
        return;
      }

      const captured = captureActiveViewport(servicesManager);
      setOriginalImage(captured.dataUrl);

      const api = new ApiService();

      // Credit gate — same logic as send-message credit checks on the backend:
      // if the tenant has no AI balance left, analysis is not performed.
      const credits = await api.getAiCredits();
      setCredit(credits.available);
      if (credits.available !== null && credits.available <= 0) {
        setStatus(STATUS.INSUFFICIENT);
        return;
      }

      const studyInfo = {
        studyInstanceUid: info.studyInstanceUid,
        viewportId: info.viewportId,
        displaySetInstanceUID: info.displaySetInstanceUID || undefined,
      };

      const aiResult = await runAiAnalysis({
        imageBase64: captured.imageBase64,
        mimeType: captured.mimeType,
        studyInfo,
        model,
      });
      setResult(aiResult);

      // Optional atomic credit consumption on the backend (mirrors send-msg
      // balance deduction). If the endpoint is not deployed yet we continue.
      if (aiConfig.deductCredit) {
        const consumed = await api.consumeAiCredit();
        if (consumed && consumed.data && consumed.data.aiBalance != null) {
          setCredit(consumed.data.aiBalance);
        }
      }

      const markings = Array.isArray(aiResult.markings) ? aiResult.markings : [];
      if (markings.length) {
        const marked = await drawMarkingsOnImage(captured.dataUrl, markings);
        setMarkedImage(marked);
      }

      setStatus(STATUS.SUCCESS);
    } catch (error) {
      console.error('AI analysis failed:', error);
      setStatus(STATUS.ERROR);
      setErrorMessage(error.message || 'AI analysis failed. Please try again.');
    }
  };

  const formatTimestamp = iso => {
    try {
      return new Date(iso).toLocaleString();
    } catch (error) {
      return iso || '';
    }
  };

  return (
    <div className="bg-primary-dark relative flex h-full flex-col p-2 text-white">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h3 className="whitespace-nowrap text-lg font-bold">AI Analysis</h3>
          {credit !== null && (
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
          onClick={handleRunAnalysis}
          disabled={status === STATUS.LOADING || !hasStudy}
        >
          {status === STATUS.LOADING ? 'Analyzing…' : 'Run AI Analysis'}
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <label
          className="text-xs text-gray-300"
          htmlFor="ai-model"
        >
          AI Model:
        </label>
        <select
          id="ai-model"
          value={model}
          onChange={event => setModel(event.target.value)}
          disabled={status === STATUS.LOADING}
          className="bg-secondary-dark border-secondary-light flex-1 rounded border p-1 text-xs text-white focus:outline-none"
        >
          {availableModels.map(m => (
            <option
              key={m}
              value={m}
              className="bg-secondary-dark"
            >
              {m}
            </option>
          ))}
        </select>
      </div>

      {!hasStudy && status === STATUS.IDLE && (
        <div className="mb-14 p-2 text-sm text-gray-300">
          Open a study and click <b>Run AI Analysis</b> to send the currently displayed image to the
          AI model.
        </div>
      )}

      {status === STATUS.LOADING && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-gray-200">
          <div className="border-primary-light h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
          <p className="text-center text-sm">
            Sending the open image to AI ({model}) and reviewing it…
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
          {credit !== null && <p className="mt-2 text-xs">Available AI credits: {credit}</p>}
        </div>
      )}

      {status === STATUS.ERROR && (
        <div className="bg-secondary-dark mb-14 flex-1 overflow-auto rounded border border-red-600 p-3 text-red-200">
          <p className="mb-1 font-bold">Analysis failed</p>
          <p className="break-words text-sm">{errorMessage}</p>
        </div>
      )}

      {status === STATUS.SUCCESS && originalImage && (
        <div className="mb-16 flex min-h-0 w-full flex-1 flex-col overflow-auto whitespace-pre-wrap">
          <div className="bg-secondary-dark border-secondary-light mb-2 overflow-auto rounded border p-2 text-white">
            {result.modelUsed && (
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-gray-300">
                  {result.provider === 'gemini' ? 'Gemini' : result.provider} · {result.modelUsed}
                </span>
                {result.confidence && (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-bold ${
                      result.confidence === 'high'
                        ? 'bg-green-800 text-green-100'
                        : result.confidence === 'medium'
                          ? 'bg-yellow-800 text-yellow-100'
                          : 'bg-orange-800 text-orange-100'
                    }`}
                  >
                    Confidence: {result.confidence}
                  </span>
                )}
              </div>
            )}

            {markedImage && (
              <div className="relative mb-2">
                {showMarked && (
                  <img
                    src={markedImage}
                    alt="AI marked image"
                    className="border-primary-main w-full rounded border"
                  />
                )}
                {!showMarked && (
                  <img
                    src={originalImage}
                    alt="Original image"
                    className="border-secondary-light w-full rounded border"
                  />
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      showMarked ? 'bg-primary-main text-white' : 'bg-black/60 text-gray-300'
                    }`}
                    onClick={() => setShowMarked(true)}
                  >
                    Marked
                  </button>
                  <button
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      !showMarked ? 'bg-primary-main text-white' : 'bg-black/60 text-gray-300'
                    }`}
                    onClick={() => setShowMarked(false)}
                  >
                    Original
                  </button>
                </div>
                {Array.isArray(result.markings) && result.markings.length > 0 && (
                  <p className="mt-1 text-xs text-gray-300">
                    {result.markings.length} region{result.markings.length > 1 ? 's' : ''}{' '}
                    highlighted by AI.
                  </p>
                )}
              </div>
            )}

            {!markedImage && (
              <img
                src={originalImage}
                alt="Original image"
                className="border-secondary-light mb-2 w-full rounded border"
              />
            )}

            {result.findings && (
              <div className="mb-2">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
                  AI Findings
                </p>
                <p className="text-sm">{result.findings}</p>
              </div>
            )}

            {result.conclusion && (
              <div className="mb-1">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
                  Impression / Conclusion
                </p>
                <p className="text-sm italic">{result.conclusion}</p>
              </div>
            )}
          </div>

          <div className="mb-2 rounded border border-green-700 bg-green-900/40 p-2 text-green-100">
            <p className="mb-1 text-xs font-bold">
              ✓ AI-Verified Review — this image was checked and analyzed by AI
            </p>
            <p className="text-xs">
              Model <b>{result.modelUsed}</b> reviewed the currently open image on{' '}
              <b>{formatTimestamp(result.analyzedAt)}</b>. AI markings shown above are preliminary
              findings only and do not replace a radiologist&apos;s final report.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

AIAnalysisPanel.propTypes = {
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      viewportGridService: PropTypes.shape({
        getState: PropTypes.func.isRequired,
        subscribe: PropTypes.func,
        unsubscribe: PropTypes.func,
        EVENTS: PropTypes.object,
      }).isRequired,
    }).isRequired,
  }).isRequired,
  extensionManager: PropTypes.object,
};

export default AIAnalysisPanel;
