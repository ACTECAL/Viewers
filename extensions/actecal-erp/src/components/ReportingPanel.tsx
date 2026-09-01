import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSystem } from '@ohif/core';
import ApiService from '../services/ApiService';

// Lexical imports
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';

import {
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
} from 'lexical';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListNode, ListItemNode } from '@lexical/list';
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text';
import { $setBlocksType, $patchStyleText } from '@lexical/selection';
import { TablePlugin } from '@lexical/react/LexicalTablePlugin';
import { TableNode, TableCellNode, TableRowNode, INSERT_TABLE_COMMAND } from '@lexical/table';
import {
  $getSelection,
  $isRangeSelection,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  CLEAR_EDITOR_COMMAND,
} from 'lexical';
import { $generateNodesFromDOM } from '@lexical/html';

const theme = {
  paragraph: 'mb-2',
  heading: {
    h1: 'text-2xl font-bold mb-3 mt-4',
    h2: 'text-xl font-semibold mb-2 mt-3',
  },
  list: {
    ul: 'list-disc pl-6 mb-2',
    ol: 'list-decimal pl-6 mb-2',
    listitem: 'mb-1',
  },
  quote: 'border-l-4 border-primary pl-4 italic text-gray-400 mb-2 py-1',
  text: {
    bold: 'font-bold',
    italic: 'italic',
    underline: 'underline',
    strikethrough: 'line-through',
  },
  table: 'border-collapse border border-gray-300 w-full mt-2 mb-2',
  tableCell: 'border border-gray-300 p-2 text-left align-top min-w-[50px]',
  tableCellHeader: 'bg-gray-100 font-bold',
  tableRow: '',
};

const editorStateCache = new Map();

function onError(error: Error) {
  console.error(error);
}

function applyContentToEditor(editor, value) {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    return;
  }

  // 1. Try to load as Lexical JSON (both bare editorState and wrapped { editorState: ... })
  let loadedJSON = false;
  let htmlFallbackValue = value;

  try {
    const parsed = JSON.parse(value);
    let parsedObject = parsed;
    // Unwrap { editorState: {...} } wrapper (like Lexical playground export)
    if (parsed && typeof parsed === 'object' && parsed.editorState && !parsed.root) {
      parsedObject = parsed.editorState;
    }

    if (parsedObject && typeof parsedObject === 'object' && parsedObject.root) {
      try {
        const state = editor.parseEditorState(JSON.stringify(parsedObject));
        editor.setEditorState(state);
        console.log('[InitialStatePlugin] Loaded Lexical JSON successfully.');
        loadedJSON = true;
      } catch (parseError) {
        console.error('[InitialStatePlugin] parseEditorState failed:', parseError);
      }
    }
  } catch (e) {
    // Not valid JSON -> fall through to HTML/text loading
  }

  // 2. Fallback: load as HTML (or plain text) using $generateNodesFromDOM
  if (!loadedJSON) {
    editor.update(
      () => {
        try {
          const parser = new DOMParser();
          const dom = parser.parseFromString(htmlFallbackValue, 'text/html');
          const nodesFromHtml = $generateNodesFromDOM(editor, dom);

          const root = $getRoot();
          root.clear();

          if (!nodesFromHtml || nodesFromHtml.length === 0) {
            const p = $createParagraphNode();
            p.append($createTextNode(''));
            root.append(p);
          } else {
            let currentParagraph = null;
            for (const node of nodesFromHtml) {
              if ($isElementNode(node)) {
                currentParagraph = null;
                root.append(node);
              } else if (node.getType() === 'text' || node.getType() === 'link') {
                if (!currentParagraph) {
                  currentParagraph = $createParagraphNode();
                  root.append(currentParagraph);
                }
                currentParagraph.append(node);
              } else {
                root.append(node);
              }
            }
          }
          root.selectEnd();
          console.log('[InitialStatePlugin] Loaded as HTML fallback successfully.');
        } catch (err) {
          console.error('[InitialStatePlugin] Failed to load HTML content:', err);
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(String(htmlFallbackValue)));
          root.append(p);
        }
      },
      { discrete: true },
    );
  }
}

function InitialStatePlugin({ content, studyUid, prefillContent }: { content: string | null, studyUid: string, prefillContent?: string | null }) {
  const [editor] = useLexicalComposerContext();
  const [isInitialized, setIsInitialized] = useState(false);
  const lastPrefillRef = useRef<string | null>(null);

  // Template prefill: when prefillContent changes to a non-null value, reload the editor
  // (bypasses the one-time initialization so a template can replace existing content).
  useEffect(() => {
    if (prefillContent === null || typeof prefillContent !== 'string') return;
    if (prefillContent === lastPrefillRef.current) return;
    lastPrefillRef.current = prefillContent;
    // Invalidate cache so the prefilled content is not shadowed on next open
    if (studyUid) {
      editorStateCache.delete(studyUid);
    }
    applyContentToEditor(editor, prefillContent);
    setIsInitialized(true);
  }, [prefillContent, editor, studyUid]);

  useEffect(() => {
    if (content === null || isInitialized) return;

    // 1. Restore from in-session cache if available (keeps unsaved edits across panel toggles)
    if (studyUid && editorStateCache.has(studyUid)) {
      console.log('[InitialStatePlugin] Restoring from cache for studyUid:', studyUid);
      try {
        const savedState = editorStateCache.get(studyUid);
        editor.setEditorState(savedState);
        console.log('[InitialStatePlugin] Cache restored successfully.');
        setIsInitialized(true);
        return;
      } catch (e) {
        console.error('[InitialStatePlugin] Failed to restore cache:', e);
      }
    }

    // 2. Empty content -> reset the editor to a blank state
    if (!content || typeof content !== 'string' || content.trim() === '') {
      editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
      setIsInitialized(true);
      return;
    }

    applyContentToEditor(editor, content);
    setIsInitialized(true);
  }, [content, studyUid, editor, isInitialized]);
  return null;
}

function MeasurementInjectionPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleInjectMeasurement = (e: any) => {
      const measurement = e.detail?.measurement;
      if (!measurement) return;

      editor.update(() => {
        const root = $getRoot();

        let textToAppend = 'Measurement added';
        // Try to intelligently parse OHIF measurement text
        if (measurement.displayText) {
          if (Array.isArray(measurement.displayText)) {
            textToAppend = measurement.displayText.join(', ');
          } else if (typeof measurement.displayText === 'object') {
            const primary = measurement.displayText.primary;
            if (Array.isArray(primary)) {
              textToAppend = primary.join(', ');
            } else if (primary) {
              textToAppend = primary.toString();
            } else {
              textToAppend = JSON.stringify(measurement.displayText);
            }
          } else {
            textToAppend = String(measurement.displayText);
          }
        } else if (measurement.text) {
            textToAppend = measurement.text;
        } else if (measurement.toolName) {
            textToAppend = `${measurement.toolName} annotation recorded.`;
        }

        const paragraphNode = $createParagraphNode();
        paragraphNode.append($createTextNode(`• ${textToAppend}`));
        root.append(paragraphNode);
      });
    };

    window.addEventListener('actecal:injectMeasurement', handleInjectMeasurement);
    return () => window.removeEventListener('actecal:injectMeasurement', handleInjectMeasurement);
  }, [editor]);

  return null;
}

function SubmitReportPlugin({ studyUid }: { studyUid: string }) {
  const [editor] = useLexicalComposerContext();
  const { servicesManager } = useSystem();
  const { uiNotificationService } = servicesManager.services;

  useEffect(() => {
    const handleSubmit = async () => {
      if (!studyUid) return;

      try {
        uiNotificationService.show({
          title: 'Submitting Report',
          message: 'Preparing your report for submission...',
          type: 'info',
        });

        // 1. Extract JSON state
        const editorState = editor.getEditorState();
        const jsonState = editorState.toJSON();
        const jsonBlob = new Blob([JSON.stringify(jsonState)], { type: 'application/json' });

        // 2. Generate PDF
        const editorRoot = document.querySelector('.ActecalReportingEditor-root') || document.querySelector('[data-lexical-editor]');
        if (!editorRoot) {
           throw new Error("Could not find editor DOM element");
        }

        uiNotificationService.show({
          title: 'Generating PDF',
          message: 'Creating PDF version of your report...',
          type: 'info',
        });

        const html2pdf = (await import('html2pdf.js')).default;

        const pdfOpt = {
          margin:       10,
          filename:     'report.pdf',
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2 },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const pdfBlob = await html2pdf().set(pdfOpt).from(editorRoot).output('blob');

        uiNotificationService.show({
          title: 'Uploading Report',
          message: 'Uploading report files to server...',
          type: 'info',
        });

        // 3. Get Presigned URLs
        const apiService = new ApiService();
        const urls = await apiService.getSubmitReportUrls(studyUid);
        const { lexicalUploadUrl, pdfUploadUrl } = urls;

        if (!lexicalUploadUrl || !pdfUploadUrl) {
           throw new Error("Backend did not provide valid upload URLs");
        }

        // 4. Upload JSON
        const jsonUpload = fetch(lexicalUploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBlob
        });

        // 5. Upload PDF
        const pdfUpload = fetch(pdfUploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: pdfBlob
        });

        await Promise.all([jsonUpload, pdfUpload]);

        // 6. Confirm Submission
        await apiService.confirmReportSubmission(studyUid);

        uiNotificationService.show({
          title: 'Report Submitted',
          message: 'Report successfully submitted to the server!',
          type: 'success',
          duration: 5000,
        });

      } catch (err: any) {
        console.error("Submit Report Failed:", err);
        uiNotificationService.show({
          title: 'Submission Failed',
          message: err.message || 'Failed to submit report',
          type: 'error',
          duration: 10000,
        });
      }
    };

    window.addEventListener('trigger-submit-report', handleSubmit);
    return () => {
      window.removeEventListener('trigger-submit-report', handleSubmit);
    };
  }, [editor, studyUid, uiNotificationService]);

  return null;
}

function ToolbarPlugin({ isExpanded, studyUid, erpRefId }) {
  const [editor] = useLexicalComposerContext();
  const [isRecording, setIsRecording] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');

  const formatHeading = (headingSize) => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createHeadingNode(headingSize));
      }
    });
  };

  const formatQuote = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createQuoteNode());
      }
    });
  };

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const handleBlockTypeChange = (e) => {
    const type = e.target.value;
    setBlockType(type);
    if (type === 'h1' || type === 'h2') {
      formatHeading(type);
    } else if (type === 'quote') {
      formatQuote();
    } else {
      formatParagraph();
    }
  };

  // ── GCP audio recording (MediaRecorder) ─────────────────────────────
  const mediaRecorderRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingConfigRef = useRef<any>(null);
  const recordingChunkIndexRef = useRef(0);

  const uploadToGcpPath = async (blob: Blob, fileName: string, mimeType: string) => {
    const cfg = recordingConfigRef.current;
    if (!blob || !cfg?.token || !cfg?.bucket || !cfg?.prefix) {
      console.warn('Recording config missing, skipping GCP upload');
      return false;
    }
    try {
      const fullName = `${cfg.prefix}/${fileName}`;
      const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${cfg.bucket}/o?uploadType=media&name=${encodeURIComponent(fullName)}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': mimeType || blob.type,
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`GCS upload failed: ${res.status}`);
      console.log('Uploaded to GCP:', fullName);
      return true;
    } catch (err) {
      console.error('Failed to upload to GCP:', err);
      return false;
    }
  };

  const handleAudioChunk = async (blob: Blob, mimeType: string) => {
    const ext = mimeType?.includes('mp4') ? 'mp4' : 'webm';
    const index = recordingChunkIndexRef.current;
    recordingChunkIndexRef.current += 1;
    await uploadToGcpPath(blob, `chunk_${index}.${ext}`, mimeType);
  };

  const handleStopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {
        /* noop */
      }
    }
    const mimeType = recorder?.mimeType || 'audio/webm';
    const fullBlob = new Blob(recordingChunksRef.current, { type: mimeType });
    recordingChunksRef.current = [];
    if (fullBlob.size > 0) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = mimeType?.includes('mp4') ? 'mp4' : 'webm';
      await uploadToGcpPath(fullBlob, `complete_recording_${ts}.${ext}`, mimeType);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordingChunkIndexRef.current = 0;
    setIsRecording(false);
  };

  const fetchRecordingConfig = async () => {
    try {
      const apiService = new ApiService();
      const refId = (erpRefId || studyUid || 'unknown');
      const res = await apiService.getRecordingConfig(refId);
      const d = res?.data?.data;
      if (d?.google_token && d?.bucket_details?.bucketName && d?.recording_path) {
        recordingConfigRef.current = {
          token: d.google_token,
          bucket: d.bucket_details.bucketName,
          prefix: d.recording_path,
          visitId: d.visit_id || null,
        };
        return true;
      }
    } catch (err) {
      console.error('Failed to fetch recording config:', err);
    }
    return false;
  };

  const handleMicClick = async () => {
    if (isRecording) {
      await handleStopRecording();
      return;
    }

    try {
      const ok = await fetchRecordingConfig();
      if (!ok) {
        console.warn('Could not get recording config from backend');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recordingChunksRef.current = [];
      recordingChunkIndexRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
          handleAudioChunk(event.data, mimeType);
        }
      };

      recorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event.error);
        setIsRecording(false);
      };

      recorder.start(30000); // chunk every 30 seconds
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start audio recording:', err);
      setIsRecording(false);
    }
  };

  // Cleanup recording (mic + stream) when the toolbar unmounts
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (_) {
          /* noop */
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const insertTable = () => {
    const rows = prompt("Enter number of rows:", "3");
    if (!rows) return;
    const columns = prompt("Enter number of columns:", "3");
    if (!columns) return;

    // Convert to string as Lexical expects string for columns/rows in some versions, or number in others.
    // Lexical's default TablePlugin expects { columns: string, rows: string } or { columns: number, rows: number }.
    // Passing as strings matches the previous hardcoded behavior.
    editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns, rows });
  };

  const buttonClass = "px-1.5 py-0.5 min-w-[28px] bg-white rounded flex items-center justify-center hover:bg-gray-100 hover:text-black transition-colors border border-gray-300 shadow-sm text-gray-700";

  return (
    <div className="flex flex-wrap gap-1 p-1 bg-white border-b border-gray-300 items-center text-sm sticky top-0 z-10 text-gray-800 shadow-sm overflow-visible">
      {!isExpanded ? (
        <div className="flex flex-col gap-1 w-full overflow-hidden">
          <div className="flex flex-nowrap gap-1 items-center w-full">
            <button
              onClick={handleMicClick}
              className={`${buttonClass} ${isRecording ? 'bg-red-100 text-red-700 border-red-300 animate-pulse' : 'text-blue-600 font-bold border-blue-200 hover:bg-blue-50'} shrink-0`}
              title="Record audio and save to GCP"
            >
              {isRecording ? '🛑 Rec...' : '🎤 Record'}
            </button>

            <div className="w-px h-5 bg-gray-300 mx-0.5 shrink-0"></div>

            <select
              onChange={(e) => {
                editor.update(() => {
                  const selection = $getSelection();
                  if ($isRangeSelection(selection)) {
                    $patchStyleText(selection, { 'font-family': e.target.value });
                  }
                });
              }}
              className="px-1.5 py-1 bg-white border border-gray-300 rounded text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-auto min-w-0"
              defaultValue="Arial"
            >
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Courier New">Courier New</option>
              <option value="Georgia">Georgia</option>
              <option value="Verdana">Verdana</option>
            </select>

            <select
              onChange={(e) => {
                editor.update(() => {
                  const selection = $getSelection();
                  if ($isRangeSelection(selection)) {
                    $patchStyleText(selection, { 'font-size': e.target.value });
                  }
                });
              }}
              className="px-1.5 py-1 bg-white border border-gray-300 rounded text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-auto min-w-0"
              defaultValue="14px"
            >
              <option value="12px">12px</option>
              <option value="14px">14px</option>
              <option value="16px">16px</option>
              <option value="18px">18px</option>
              <option value="20px">20px</option>
              <option value="24px">24px</option>
            </select>
          </div>

          <div className="flex flex-nowrap gap-1 items-center w-full mt-1">
            <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} className={buttonClass + " font-bold shrink-0"} title="Bold">B</button>
            <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} className={buttonClass + " italic font-serif shrink-0"} title="Italic">I</button>
            <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} className={buttonClass + " underline shrink-0"} title="Underline">U</button>

            <div className="w-px h-5 bg-gray-300 mx-0.5 shrink-0"></div>

            <button onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} className={buttonClass + " shrink-0"} title="Bullet List">• List</button>
            <button onClick={insertTable} className={buttonClass + " shrink-0"} title="Table">⊞</button>

            <div className="w-px h-5 bg-gray-300 mx-0.5 shrink-0"></div>

            <select
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'undo') {
                  editor.dispatchCommand(UNDO_COMMAND, undefined);
                } else if (val === 'redo') {
                  editor.dispatchCommand(REDO_COMMAND, undefined);
                } else if (val === 'strikethrough') {
                  editor.dispatchCommand(FORMAT_TEXT_COMMAND, val);
                } else if (val === 'number') {
                  editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
                } else if (['left', 'center', 'right', 'justify'].includes(val)) {
                  editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, val);
                } else if (['h1', 'h2', 'quote', 'paragraph'].includes(val)) {
                   setBlockType(val);
                   if (val === 'h1' || val === 'h2') {
                     formatHeading(val);
                   } else if (val === 'quote') {
                     formatQuote();
                   } else {
                     formatParagraph();
                   }
                }
                e.target.value = '';
              }}
              className="px-1.5 py-1 bg-white border border-gray-300 rounded text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 flex-1 min-w-0"
              defaultValue=""
            >
              <option value="" disabled hidden>More...</option>
              <optgroup label="History">
                <option value="undo">Undo</option>
                <option value="redo">Redo</option>
              </optgroup>
            <optgroup label="Blocks">
              <option value="paragraph">Normal</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="quote">Quote</option>
            </optgroup>
            <optgroup label="Text & Lists">
              <option value="strikethrough">Strikethrough</option>
              <option value="number">Numbered List</option>
            </optgroup>
            <optgroup label="Align">
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justify</option>
            </optgroup>
          </select>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={handleMicClick}
            className={`${buttonClass} ${isRecording ? 'bg-red-100 text-red-700 border-red-300 animate-pulse' : 'text-blue-600 font-bold border-blue-200 hover:bg-blue-50'}`}
            title="Record audio and save to GCP"
          >
            {isRecording ? '🛑 Recording...' : '🎤 Record'}
          </button>

          <div className="w-px h-5 bg-gray-300 mx-1"></div>

          <select
            value={blockType}
            onChange={handleBlockTypeChange}
            className="px-2 py-1 bg-white border border-gray-300 rounded text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[100px]"
          >
            <option value="paragraph">Normal</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="quote">Quote</option>
          </select>

          <div className="w-px h-5 bg-gray-300 mx-1"></div>

          <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} className={buttonClass + " font-bold"} title="Bold">B</button>
          <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} className={buttonClass + " italic font-serif"} title="Italic">I</button>
          <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} className={buttonClass + " underline"} title="Underline">U</button>
          <button onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough')} className={buttonClass + " line-through"} title="Strikethrough">S</button>

          <div className="w-px h-5 bg-gray-300 mx-1"></div>

          <button onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} className={buttonClass} title="Bullet List">• List</button>
          <button onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} className={buttonClass} title="Numbered List">1. List</button>
          <button onClick={insertTable} className={buttonClass} title="Table">⊞</button>

          <div className="w-px h-5 bg-gray-300 mx-1"></div>

          <select
            onChange={(e) => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, e.target.value)}
            className="px-2 py-1 bg-white border border-gray-300 rounded text-gray-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[90px]"
            defaultValue=""
          >
            <option value="" disabled hidden>Align</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </>
      )}
    </div>
  );
}

function ReportingPanel() {
  const { servicesManager, extensionManager, hotkeysManager } = useSystem();
  const { viewportGridService } = servicesManager.services;
  const [draftContent, setDraftContent] = useState<string | null>(null);
  const [studyUid, setStudyUid] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const editorContainerRef = useRef(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [prefillContent, setPrefillContent] = useState<string | null>(null);
  const [erpRefId, setErpRefId] = useState<string>('');

  // Fetch available report templates from the backend (ERP get-templates)
  useEffect(() => {
    let cancelled = false;
    const fetchTemplates = async () => {
      try {
        const apiService = new ApiService();
        const res = await apiService.getTemplates(100, 1);
        const list = res?.data?.data?.template || [];
        if (!cancelled) setTemplates(list);
      } catch (err) {
        console.warn('Failed to fetch templates:', err);
      }
    };
    fetchTemplates();
    return () => { cancelled = true; };
  }, []);

  // Template selection -> view-template -> fetch presigned URL -> prefill editor
  const handleTemplateSelect = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setPrefillContent(null);
      return;
    }
    try {
      const apiService = new ApiService();
      const res = await apiService.viewTemplate(templateId);
      const downloadUrl = res?.data?.data?.url;
      if (!downloadUrl) {
        console.warn('Template has no content URL');
        return;
      }
      const fetchRes = await fetch(downloadUrl);
      const text = await fetchRes.text();
      if (text) {
        setPrefillContent(text);
      }
    } catch (err) {
      console.error('Failed to load template content:', err);
    }
  };


  // Track the active study: subscribe to viewport changes and update studyUid
  // whenever a new/acactive study becomes visible (so auto-fill runs on open).
  useEffect(() => {
    const subscription = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      () => {
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const currentUid = activeViewport?.StudyInstanceUID;

        if (currentUid && currentUid !== studyUid) {
          setStudyUid(currentUid);
        }
      }
    );

    const state = viewportGridService.getState();
    const activeViewport = state.viewports[state.activeViewportIndex];
    const initialUid = activeViewport?.StudyInstanceUID;
    if (initialUid) {
      setStudyUid(initialUid);
    }

    return () => subscription.unsubscribe();
  }, [viewportGridService, studyUid]);

  // When the active study changes: auto-fill template (based on patient ref no
  // + test) on open, and prefetch the GCP recording config keyed by ref id so
  // recording can start instantly on the mic button.
  useEffect(() => {
    if (!studyUid) {
      setDraftContent('');
      return;
    }

    let cancelled = false;

    const loadStudyContent = async () => {
      try {
        const apiService = new ApiService();

        // Auto-fill: resolve study -> ref no + test/department -> matching template
        let erpRef = '';
        try {
          const tpl = await apiService.getAutoFillTemplate(studyUid);
          if (tpl && (tpl.erpRefId || tpl.presignedUrl)) {
            erpRef = tpl.erpRefId || '';
            if (!cancelled) setErpRefId(erpRef);
            if (tpl.presignedUrl) {
              const fileRes = await fetch(tpl.presignedUrl);
              const text = await fileRes.text();
              if (text && !cancelled) {
                setDraftContent(''); // ensure editor mounts
                setPrefillContent(text);
                return;
              }
            }
          }
        } catch (err) {
          console.warn('Auto-fill template lookup failed', err);
        }

        // Prefetch recording config with the patient's ref id (ready before start).
        try {
          await apiService.getRecordingConfig(erpRef || 'unknown');
        } catch (err) {
          console.warn('Recording config prefetch failed', err);
        }

        // Fallback: load any saved draft report content.
        try {
          const response = await apiService.fetchDraftReport(studyUid);
          if (response && response.presignedUrl) {
            const fileRes = await fetch(response.presignedUrl);
            const lexicalJson = await fileRes.json();
            if (!cancelled) setDraftContent(JSON.stringify(lexicalJson));
          } else if (response && response.text) {
            if (!cancelled) setDraftContent(response.text);
          } else if (response && response.report) {
            if (!cancelled) setDraftContent(response.report);
          } else if (!cancelled) {
            setDraftContent('');
          }
        } catch (apiError) {
          console.warn('API fetch failed, falling back to default text', apiError);
          if (!cancelled) setDraftContent('');
        }
      } catch (error) {
        console.error('Failed to load report', error);
        if (!cancelled) setDraftContent('');
      }
    };

    loadStudyContent();
    return () => { cancelled = true; };
  }, [studyUid]);

  const initialConfig = {
    namespace: 'ActecalReportingEditor',
    theme,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, TableNode, TableCellNode, TableRowNode],
    onError,
  };

  const handleEditorChange = (editorState) => {
    if (studyUid) {
      editorStateCache.set(studyUid, editorState);
    }
  };

  useEffect(() => {
    const handleMobileToggle = () => setIsExpanded(prev => !prev);
    window.addEventListener('toggle-mobile-report', handleMobileToggle);
    return () => window.removeEventListener('toggle-mobile-report', handleMobileToggle);
  }, []);

  return (
    <div className="flex flex-col h-full bg-primary-dark p-2 text-white relative">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-bold">Create Report</h3>
        <div className="flex items-center gap-1">
          <select
            value={selectedTemplateId}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="text-xs bg-secondary-main border border-secondary-light rounded px-1 py-1 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[130px]"
            title="Select a template to prefill the report"
          >
            <option value="">Templates</option>
            {templates.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.department || t.test || `Template ${t.id}`}
              </option>
            ))}
          </select>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="hidden xl:flex text-sm bg-secondary-main hover:bg-primary-main px-2 py-1 rounded transition-colors border border-secondary-light items-center gap-1"
            title={isExpanded ? "Collapse" : "Pop out Editor"}
          >
            {isExpanded ? '🗗 Collapse' : '⛶ Expand'}
          </button>
        </div>
      </div>

      {draftContent !== null ? (
        <div className={`flex flex-col transition-all duration-300 ${
          isExpanded
            ? 'fixed inset-10 z-[9999] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] rounded-xl overflow-hidden ring-1 ring-black/5'
            : 'flex-1 w-full bg-secondary-dark rounded border border-secondary-light overflow-hidden'
        }`}>
          {isExpanded && (
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-200 shrink-0">
              <h2 className="text-xl font-semibold text-gray-800 tracking-tight">Create Report</h2>
              <button
                onClick={() => setIsExpanded(false)}
                className="text-gray-500 hover:text-gray-800 hover:bg-gray-200 p-2 rounded-full transition-colors flex items-center justify-center"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
          <LexicalComposer initialConfig={initialConfig}>
            <div
              ref={editorContainerRef}
              className="h-full w-full relative flex flex-col flex-1"
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
            >
              <ToolbarPlugin isExpanded={isExpanded} studyUid={studyUid} erpRefId={erpRefId} />
              <div className="flex-1 relative overflow-y-auto bg-white text-black">
                <RichTextPlugin
                  contentEditable={<ContentEditable className={`h-full w-full outline-none resize-none p-4 ${isExpanded ? 'text-lg leading-relaxed max-w-4xl mx-auto' : 'text-sm'}`} />}
                  placeholder={<div className="absolute top-4 left-4 text-gray-400 pointer-events-none">Enter report...</div>}
                  ErrorBoundary={LexicalErrorBoundary}
                />
              </div>
              <ListPlugin />
              <TablePlugin />
              <HistoryPlugin />
              <OnChangePlugin onChange={handleEditorChange} />
              <InitialStatePlugin content={draftContent} studyUid={studyUid} prefillContent={prefillContent} />
              <MeasurementInjectionPlugin />
              <SubmitReportPlugin studyUid={studyUid} />
            </div>
          </LexicalComposer>
          {isExpanded ? (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end shrink-0">
               <button
                 onClick={() => window.dispatchEvent(new Event('trigger-submit-report'))}
                 className="bg-[#5b65d6] hover:bg-[#4a54c4] text-white font-medium py-2 px-8 rounded-md shadow-sm transition-all focus:ring-2 focus:ring-offset-2 focus:ring-[#5b65d6] flex items-center gap-2 text-sm"
               >
                 ✓ Submit Report
               </button>
            </div>
          ) : (
            <div className="p-2 bg-secondary-main border-t border-secondary-light flex justify-center shrink-0">
               <button
                 onClick={() => window.dispatchEvent(new Event('trigger-submit-report'))}
                 className="bg-[#5b65d6] hover:bg-[#4a54c4] w-full text-white font-bold py-1.5 px-4 rounded shadow flex justify-center items-center gap-2 text-sm"
               >
                 ✓ Submit Report
               </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 w-full bg-secondary-dark text-white p-2 border border-secondary-light rounded flex items-center justify-center">
          Loading...
        </div>
      )}

      {/* Backdrop overlay when expanded */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}

ReportingPanel.propTypes = {
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      viewportGridService: PropTypes.shape({
        getState: PropTypes.func.isRequired,
      }).isRequired,
    }).isRequired,
  }),
  extensionManager: PropTypes.object,
};

export default ReportingPanel;
