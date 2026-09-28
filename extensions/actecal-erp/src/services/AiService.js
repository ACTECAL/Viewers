// ────────────────────────────────────────────────
// Reusable AI analysis service.
//
// Provider-agnostic factory: swap/add AI providers and models purely from
// config (window.config.ai) — no code change needed. Default provider is
// Google Gemini (MedGemma / other Gemini models).
// ────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  enabled: true,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  models: [],
  apiKey: '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  temperature: 0.2,
  deductCredit: true,
};

export function getAiConfig() {
  const user = (typeof window !== 'undefined' && window.config && window.config.ai) || {};
  return { ...DEFAULT_CONFIG, ...user };
}

function buildAnalyzePrompt(studyInfo = {}) {
  const info = Object.keys(studyInfo).length ? JSON.stringify(studyInfo, null, 2) : 'Not provided';
  return [
    'You are an experienced medical imaging analyst reviewing a radiology image that is currently open in a viewer.',
    '',
    'Study context (JSON):',
    info,
    '',
    'Analyze the attached image and respond with STRICT JSON only, no markdown, in exactly this shape:',
    '{',
    '  "findings": "string - natural language description of what you observe; list any abnormalities and their locations",',
    '  "conclusion": "string - short impression/summary",',
    '  "confidence": "low|medium|high",',
    '  "markings": [ { "label": "string", "type": "box|point", "x": 0-1, "y": 0-1, "width": 0-1, "height": 0-1 } ]',
    '}',
    '',
    'Rules:',
    '- markings x/y/width/height are fractions (0-1) of the image dimensions. Use "point" for a small region, "box" for a wider region.',
    '- Only include markings when you can localize a region; otherwise return "markings": [].',
    '- Add "severity": "low|medium|high" to each marking when applicable.',
    '- State clearly that this is a preliminary AI review only and not a final radiology report.',
  ].join('\n');
}

// Try to extract a JSON object from a raw model response
// (handles code fences / extra prose around the JSON).
function parseJsonResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('AI returned an empty response.');
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 400)}`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function callGemini({ imageBase64, mimeType, prompt, model, config }) {
  const url =
    `${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=` +
    `${encodeURIComponent(config.apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: config.temperature,
    },
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`AI network error: ${error.message}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI API error ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  const text =
    (data.candidates?.[0]?.content?.parts || [])
      .filter(part => part.text)
      .map(part => part.text)
      .join('\n') || '';

  if (!text) {
    const blockReason = data.promptFeedback?.blockReason || 'no content';
    throw new Error(`AI returned no content (${blockReason}).`);
  }

  return parseJsonResponse(text);
}

// Factory: creates an AI client for any provider + model so the model/provider
// can be swapped just by changing config (or passing an override here).
export function createAiClient(modelConfig = {}) {
  const config = { ...getAiConfig(), ...modelConfig };

  if (!config.enabled) {
    throw new Error('AI analysis is disabled in config.');
  }
  if (!config.apiKey) {
    throw new Error('AI API key not configured. Set window.config.ai.apiKey.');
  }

  const provider = String(config.provider || 'gemini').toLowerCase();

  switch (provider) {
    case 'gemini':
      return {
        provider,
        model: config.model,
        async analyzeImage({ imageBase64, mimeType, prompt, model }) {
          return callGemini({
            imageBase64,
            mimeType,
            prompt,
            model: model || config.model,
            config,
          });
        },
      };

    default:
      throw new Error(`Unsupported AI provider: "${provider}".`);
  }
}

// Convenience orchestrator used by the AI Analysis panel.
export async function runAiAnalysis({
  imageBase64,
  mimeType = 'image/jpeg',
  studyInfo = {},
  model,
}) {
  const config = getAiConfig();
  const selectedModel = model || config.model || config.defaultModel;
  const client = createAiClient({ model: selectedModel });
  const prompt = buildAnalyzePrompt(studyInfo);

  const parsed = await client.analyzeImage({ imageBase64, mimeType, prompt, model: selectedModel });
  const markings = Array.isArray(parsed?.markings) ? parsed.markings : [];

  return {
    findings: parsed?.findings || '',
    conclusion: parsed?.conclusion || '',
    confidence: parsed?.confidence || null,
    markings,
    raw: parsed,
    provider: client.provider,
    modelUsed: selectedModel,
    analyzedAt: new Date().toISOString(),
  };
}

export default {
  getAiConfig,
  createAiClient,
  runAiAnalysis,
  buildAnalyzePrompt,
};