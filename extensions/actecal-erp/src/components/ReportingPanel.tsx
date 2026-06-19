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
  $createTextNode
} from 'lexical';

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

function InitialStatePlugin({ content, studyUid }: { content: string | null, studyUid: string }) {
  const [editor] = useLexicalComposerContext();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (content !== null && !isInitialized) {
      if (studyUid && editorStateCache.has(studyUid)) {
        console.log('[InitialStatePlugin] Restoring from cache for studyUid:', studyUid);
        try {
          const savedState = editorStateCache.get(studyUid);
          editor.setEditorState(savedState);
          console.log('[InitialStatePlugin] Cache restored successfully.');
        } catch (e) {
          console.error('[InitialStatePlugin] Failed to restore cache:', e);
        }
      } else if (content) {
        console.log('[InitialStatePlugin] Setting initial content.');
        editor.update(() => {
          const rootNode = $getRoot();
          rootNode.clear();
          const paragraphNode = $createParagraphNode();
          const textNode = $createTextNode(content);
          paragraphNode.append(textNode);
          rootNode.append(paragraphNode);
        });
      } else {
        console.log('[InitialStatePlugin] Empty content, doing nothing.');
      }
      setIsInitialized(true);
    }
  }, [content, studyUid, editor, isInitialized]);
  return null;
}

function ToolbarPlugin({ isExpanded }) {
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

  const handleMicClick = () => {
    // Scaffold for actual voice integration
    setIsRecording(!isRecording);
  };

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
              title="Start Voice Dictation"
            >
              {isRecording ? '🛑 Rec...' : '🎤 Dictate'}
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
            title="Start Voice Dictation"
          >
            {isRecording ? '🛑 Recording...' : '🎤 Dictate'}
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



  useEffect(() => {
    const fetchReport = async () => {
      try {
        const state = viewportGridService.getState();
        const activeViewport = state.viewports[state.activeViewportIndex];
        const studyInstanceUid = activeViewport?.StudyInstanceUID;

        if (!studyInstanceUid) {
          setDraftContent('');
          return;
        }

        setStudyUid(studyInstanceUid);

        // Fetching from API
        const apiService = new ApiService();
        try {
          const response = await apiService.fetchDraftReport(studyInstanceUid);
          if (response && response.text) {
            setDraftContent(response.text);
          } else if (response && response.report) {
            setDraftContent(response.report);
          } else {
            setDraftContent('');
          }
        } catch (apiError) {
          console.warn('API fetch failed, falling back to default text', apiError);
          setDraftContent('');
        }

      } catch (error) {
        console.error('Failed to load draft report', error);
        setDraftContent('');
      }
    };

    fetchReport();
  }, [viewportGridService]);

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

  return (
    <div className="flex flex-col h-full bg-primary-dark p-2 text-white relative">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-bold">Create Report</h3>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm bg-secondary-main hover:bg-primary-main px-2 py-1 rounded transition-colors border border-secondary-light flex items-center gap-1"
          title={isExpanded ? "Collapse" : "Pop out Editor"}
        >
          {isExpanded ? '🗗 Collapse' : '⛶ Expand'}
        </button>
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
              <ToolbarPlugin isExpanded={isExpanded} />
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
              <InitialStatePlugin content={draftContent} studyUid={studyUid} />
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
