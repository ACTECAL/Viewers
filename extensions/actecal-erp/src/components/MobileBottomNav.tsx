import React, { useState, useEffect } from 'react';
import { useSystem } from '@ohif/core';
import ReactDOM from 'react-dom';
import { useLocation } from 'react-router-dom';
import usePatientInfo from '../../../default/src/hooks/usePatientInfo';

const MOBILE_TOOLS = [
  { id: 'StackScroll', icon: '↕️', label: 'Scroll' },
  { id: 'Pan', icon: '✋', label: 'Pan' },
  { id: 'Zoom', icon: '🔍', label: 'Zoom' },
  { id: 'WindowLevel', icon: '◐', label: 'W/L' },
  { id: 'Length', icon: '📏', label: 'Length' },
  { id: 'Bidirectional', icon: '✛', label: 'Bi-Dir' },
  { id: 'EllipticalROI', icon: '⭕', label: 'Ellipse' },
  { id: 'Angle', icon: '📐', label: 'Angle' },
];

const MENU_PANELS = [
  { id: 'aiAnalysis', icon: '🤖', label: 'AI Analysis' },
  { id: 'measurements', icon: '📏', label: 'Measurements' },
  { id: 'segmentation', icon: '🧠', label: 'Segmentation' },
  { id: 'notes', icon: '📝', label: 'Notes' },
  { id: 'annotationFilters', icon: '🎛️', label: 'Annotations' }
];

function MobileBottomNav() {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isPanelsOpen, setIsPanelsOpen] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [activeTool, setActiveTool] = useState('Pan');

  const { servicesManager, commandsManager } = useSystem();
  const { patientInfo, isMixedPatients } = usePatientInfo();
  const formatWithEllipsis = (str, maxLength) => str?.length > maxLength ? str.substring(0, maxLength) + '...' : str;

  const checkIsMobile = () => {
    // Increase breakpoint to 1200px to cover iPad landscape modes
    return window.innerWidth <= 1200;
  };

  // We only want to render this on mobile screens in portrait mode
  const [isMobile, setIsMobile] = useState(checkIsMobile());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(checkIsMobile());
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Ensure all hooks run by NOT returning early here.
  const handleToolSelect = (toolId) => {
    if (toolId === 'Reset') {
      commandsManager.runCommand('resetViewport');
      setIsToolsOpen(false);
      return;
    }
    
    if (toolId === 'Fullscreen') {
      commandsManager.runCommand('toggleFullscreen');
      setIsToolsOpen(false);
      return;
    }

    if (toolId === 'MPR') {
      commandsManager.runCommand('toggleHangingProtocol', { protocolId: 'mpr' });
      setIsToolsOpen(false);
      return;
    }

    if (toolId === 'Invert') {
      commandsManager.runCommand('invertWindowLevel');
      setIsToolsOpen(false);
      return;
    }

    if (toolId === 'FlipHorizontal') {
      commandsManager.runCommand('flipViewportHorizontal');
      setIsToolsOpen(false);
      return;
    }

    if (toolId === 'RotateRight') {
      commandsManager.runCommand('rotateViewportCW');
      setIsToolsOpen(false);
      return;
    }

    commandsManager.runCommand('setToolActive', { toolName: toolId });
    
    // Force touch bindings for mobile measurements
    try {
      const { toolGroupService } = servicesManager.services;
      if (toolGroupService) {
        const toolGroupIds = toolGroupService.getToolGroupIds();
        toolGroupIds.forEach(id => {
          toolGroupService.setToolActive(id, toolId, {
            bindings: [
              { mouseButton: 1 }, // Primary mouse
              { numTouchPoints: 1 } // 1-finger touch gesture
            ]
          });
        });
      }
    } catch (e) {
      console.warn("Could not bind touch points", e);
    }

    setActiveTool(toolId);
    setIsToolsOpen(false);
  };

  const activateRightPanelTab = (panelId) => {
    if (!isRightPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-right-panel', { detail: { forceOpen: true } }));
    }
    if (isLeftPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-left-panel', { detail: { forceClose: true } }));
    }
    document.body.classList.remove('mobile-left-panel-open');
    document.body.classList.add('mobile-right-panel-open');
    setIsRightPanelOpen(true);
    setIsLeftPanelOpen(false);
    setIsToolsOpen(false);
    setIsPanelsOpen(false);
    
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('activate-mobile-panel-tab', { detail: { panelId } }));
    }, 50);
  };

  const toggleStudiesPanel = () => {
    if (!isLeftPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-left-panel', { detail: { forceOpen: true } }));
    }
    if (isRightPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-right-panel', { detail: { forceClose: true } }));
    }
    document.body.classList.remove('mobile-right-panel-open');
    document.body.classList.add('mobile-left-panel-open');
    setIsLeftPanelOpen(true);
    setIsRightPanelOpen(false);
    setIsToolsOpen(false);
    setIsPanelsOpen(false);
  };

  const toggleEditorPanel = () => {
    activateRightPanelTab('@ohif/extension-actecal-erp.panelModule.reporting');
  };

  const showViewer = () => {
    if (isLeftPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-left-panel', { detail: { forceClose: true } }));
    }
    if (isRightPanelOpen) {
      window.dispatchEvent(new CustomEvent('toggle-mobile-right-panel', { detail: { forceClose: true } }));
    }
    document.body.classList.remove('mobile-left-panel-open', 'mobile-right-panel-open');
    setIsLeftPanelOpen(false);
    setIsRightPanelOpen(false);
    setIsToolsOpen(false);
    setIsPanelsOpen(false);
  };

  const handlePanelSelect = (panel) => {
    if (panel.customEvent) {
      window.dispatchEvent(new Event(panel.customEvent));
    } else {
      document.body.classList.add('mobile-panel-open');
    }
    setIsPanelsOpen(false);
  };

  const toggleAiPanel = () => {
    document.body.classList.add('mobile-panel-open');
    setIsToolsOpen(false);
    setIsPanelsOpen(false);
  };

  // Listen to OHIF panel close events to remove the class if closed via internal UI
  useEffect(() => {
    const handlePanelChange = (e) => {
      // If panels are closed natively
      if (e.detail?.options?.leftPanelClosed && e.detail?.options?.rightPanelClosed) {
        document.body.classList.remove('mobile-left-panel-open', 'mobile-right-panel-open');
        setIsLeftPanelOpen(false);
        setIsRightPanelOpen(false);
      }
    };
    
    window.addEventListener('panel-tab-changed', handlePanelChange);
    
    return () => {
      window.removeEventListener('panel-tab-changed', handlePanelChange);
    };
  }, []);

  // Explicitly listen to the OPEN button custom event
  useEffect(() => {
    const handleForceShow = () => {
      setTimeout(() => {
        showViewer();
      }, 100);
    };
    window.addEventListener('mobile-force-show-viewer', handleForceShow);
    return () => {
      window.removeEventListener('mobile-force-show-viewer', handleForceShow);
    };
  }, [isLeftPanelOpen, isRightPanelOpen]);

  const toggleToolsSheet = () => {
    setIsToolsOpen(!isToolsOpen);
    setIsPanelsOpen(false);
  };

  const togglePanelsSheet = () => {
    setIsPanelsOpen(!isPanelsOpen);
    setIsToolsOpen(false);
  };

  const MobileStyles = (
    <style>{`
        /* =========================================
           PORTRAIT ONLY OVERRIDES
        ========================================= */
        @media (orientation: portrait) {
          /* Top Header Aggressive Hiding */
          div[class*="gap-2"][class*="px-2"] > svg { display: none !important; }
          div[class*="text-muted-foreground"][class*="text-[11px]"] > div:nth-child(1),
          div[class*="text-muted-foreground"][class*="text-[11px]"] > div:nth-child(2) { display: none !important; }
          
          div[class*="text-[13px]"][class*="font-bold"] {
            font-size: 11px !important;
            line-height: 1.2 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            text-align: right !important;
            display: block !important;
          }
          div[class*="text-[11px]"][class*="text-muted-foreground"] {
            font-size: 10px !important;
            line-height: 1.2 !important;
            margin-top: 2px !important;
            text-align: right !important;
            justify-content: flex-end !important;
          }

          /* Main Viewer & Panels */
          .ViewerLayout-main {
            height: calc(100vh - 48px) !important;
            height: calc(100dvh - 48px) !important;
            padding-bottom: 70px !important;
          }

          /* Side Panels Absolute Position */
          [data-panel-id="viewerLayoutResizableLeftPanel"],
          [data-panel-id="viewerLayoutResizableRightPanel"] {
            position: absolute !important;
            top: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            max-width: 100vw !important;
            height: 100% !important;
            z-index: 1000 !important;
            background: #090c29 !important;
            transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out !important;
            padding-bottom: 80px !important;
          }

          [data-panel-id="viewerLayoutResizableLeftPanel"] .side-panel-root,
          [data-panel-id="viewerLayoutResizableRightPanel"] .side-panel-root {
            width: 100vw !important;
            max-width: 100vw !important;
          }

          /* Left Panel State */
          ${isLeftPanelOpen ? `
          [data-panel-id="viewerLayoutResizableLeftPanel"] {
            transform: translateX(0) !important;
            opacity: 1 !important;
            pointer-events: auto !important;
            display: flex !important;
          }
          ` : `
          [data-panel-id="viewerLayoutResizableLeftPanel"] {
            transform: translateX(-100%) !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          `}

          /* Right Panel State */
          ${isRightPanelOpen ? `
          [data-panel-id="viewerLayoutResizableRightPanel"] {
            transform: translateX(0) !important;
            opacity: 1 !important;
            pointer-events: auto !important;
            display: flex !important;
          }
          ` : `
          [data-panel-id="viewerLayoutResizableRightPanel"] {
            transform: translateX(100%) !important;
            opacity: 0 !important;
            pointer-events: none !important;
          }
          `}

          /* Hide custom left panel in portrait */
          .mobile-left-info-panel {
             display: none !important;
          }
        }


        /* Hide the closed-state icons and side tabs to let content take 100% width */
        [data-panel-id="viewerLayoutResizableLeftPanel"] .mt-3.flex.flex-col,
        [data-cy="side-panel-header-left"],
        [data-cy="side-panel-header-right"],
        [data-panel-id="viewerLayoutResizableLeftPanel"] .bg-secondary-dark.flex.flex-col {
          display: none !important;
        }

        /* Hide any resize handles on mobile */
        [data-panel-resize-handle-id] {
          display: none !important;
        }

        /* Ensure panel contents scroll properly */
        [data-panel-id="viewerLayoutResizableLeftPanel"] > div,
        [data-panel-id="viewerLayoutResizableRightPanel"] > div,
        .ohif-scrollbar {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          flex: 1 !important;
        }

        /* =========================================
           LANDSCAPE OVERRIDES
        ========================================= */
        @media (orientation: landscape) and (max-width: 1200px) {
          /* Hide default top header completely */
          .mobile-desktop-header { display: none !important; }
          
          .flex-nowrap.items-stretch.overflow-hidden.bg-background {
             height: 100vh !important;
             height: 100dvh !important;
             padding-bottom: 0 !important;
             padding-left: 120px !important;
             padding-right: 70px !important;
             margin-top: 0 !important;
          }

          /* Side panel root override */
          [data-panel-id="viewerLayoutResizableLeftPanel"] .side-panel-root,
          [data-panel-id="viewerLayoutResizableRightPanel"] .side-panel-root {
            width: calc(100vw - 190px) !important;
            max-width: calc(100vw - 190px) !important;
          }

          /* Left and Right side panels positioning */
          ${isLeftPanelOpen ? `
          [data-panel-id="viewerLayoutResizableLeftPanel"] {
             left: 120px !important;
             width: calc(100vw - 190px) !important;
             max-width: calc(100vw - 190px) !important;
             display: flex !important;
             transform: translateX(0) !important;
             opacity: 1 !important;
             pointer-events: auto !important;
             position: absolute !important;
             top: 0 !important;
             bottom: 0 !important;
             height: 100% !important;
             z-index: 10000 !important;
             background: #090c14 !important;
          }
          ` : `
          [data-panel-id="viewerLayoutResizableLeftPanel"] {
             display: none !important;
          }
          `}

          ${isRightPanelOpen ? `
          [data-panel-id="viewerLayoutResizableRightPanel"] {
             right: 70px !important;
             left: auto !important;
             width: calc(100vw - 190px) !important;
             max-width: calc(100vw - 190px) !important;
             display: flex !important;
             transform: translateX(0) !important;
             opacity: 1 !important;
             pointer-events: auto !important;
             position: absolute !important;
             top: 0 !important;
             bottom: 0 !important;
             height: 100% !important;
             z-index: 10000 !important;
             background: #090c14 !important;
          }
          ` : `
          [data-panel-id="viewerLayoutResizableRightPanel"] {
             display: none !important;
          }
          `}

          /* Our custom Left Panel with Logo */
          .mobile-left-info-panel {
             display: flex !important;
             flex-direction: column !important;
             z-index: 9990 !important;
          }

          /* Bottom Nav becomes Right Sidebar */
          .mobile-nav-bar {
             top: 0 !important;
             bottom: 0 !important;
             right: 0 !important;
             left: auto !important;
             width: 70px !important;
             height: 100vh !important;
             flex-direction: column !important;
             border-top: none !important;
             border-left: 1px solid #3a3f99 !important;
             padding: 10px 0 !important;
          }
          .mobile-nav-bar > button {
             width: 100% !important;
             height: 20% !important;
          }
          
          /* Sheets (Tools/Menu) slide from right instead of bottom */
          .mobile-sheet {
             top: 0 !important;
             bottom: 0 !important;
             right: 70px !important;
             left: auto !important;
             width: 300px !important;
             height: 100vh !important;
             border-radius: 12px 0 0 12px !important;
             border-top: none !important;
             border-left: 1px solid #3a3f99 !important;
             border-bottom: 1px solid #3a3f99 !important;
          }
        }

        /* Base styles for the custom left panel (always applied) */
        .mobile-left-info-panel {
           position: fixed !important;
           top: 0 !important;
           left: 0 !important;
           bottom: 0 !important;
           width: 120px !important;
           background: #090c14 !important;
           border-right: 1px solid #3a3f99 !important;
           z-index: 9999 !important;
           pointer-events: auto !important;
           padding-top: 20px !important;
           align-items: center !important;
           display: none !important;
        }

        /* Show left info panel ONLY in landscape */
        @media (orientation: landscape) {
          .mobile-left-info-panel {
             display: flex !important;
             flex-direction: column !important;
          }
        }
    `}</style>
  );

  const NavContent = (
    <div className="fixed inset-0 z-[10010] pointer-events-none">
      {MobileStyles}
      
      {/* Left Info Panel for Landscape */}
      <div className="mobile-left-info-panel">
        <div className="flex flex-col items-center gap-2 mb-8">
          <svg className="w-10 h-10" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect x="15" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.6" />
            <rect x="35" y="25" width="10" height="50" rx="5" fill="#0D6EFD" opacity="0.8" />
            <rect x="55" y="10" width="10" height="80" rx="5" fill="#FFFFFF" />
            <rect x="75" y="30" width="10" height="40" rx="5" fill="#5ACCE6" />
          </svg>
          <div className="text-white font-bold text-[16px] tracking-wider uppercase text-center w-full">SPECTRA</div>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg p-2 bg-[#1e2235] w-[90%] mx-auto mt-4">
          {isMixedPatients ? (
            <svg className="text-[#5b65d6] w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
          ) : (
            <svg className="text-[#5b65d6] w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          )}
          <div className="flex flex-col justify-center items-center text-center mt-2 w-full">
            {!isMixedPatients ? (
              <>
                <div className="text-white text-[12px] font-bold leading-tight break-words">
                  {formatWithEllipsis(patientInfo.PatientName || 'No Name', 30)}
                </div>
                <div className="text-gray-400 flex flex-col gap-1 text-[10px] mt-2">
                  <div>{formatWithEllipsis(patientInfo.PatientID || '-', 15)}</div>
                  <div>{patientInfo.PatientSex || '-'}</div>
                  <div>{patientInfo.PatientDOB || '-'}</div>
                </div>
              </>
            ) : (
              <div className="text-white text-[12px] font-bold">
                Multiple Patients
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Tools Sheet */}
      {isToolsOpen && (
        <div className="mobile-sheet absolute bottom-[70px] left-0 right-0 bg-[#090c14] border-t border-[#3a3f99] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] z-[10005] rounded-t-xl p-4 transition-transform duration-300 transform translate-y-0 pointer-events-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-white font-semibold text-sm">Tools</h3>
            <button onClick={() => setIsToolsOpen(false)} className="text-gray-400 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto">
            {[
              { id: 'StackScroll', label: 'Scroll', icon: '↕️' },
              { id: 'Zoom', label: 'Zoom', icon: '🔍' },
              { id: 'Pan', label: 'Pan', icon: '✋' },
              { id: 'WindowLevel', label: 'W/L', icon: '◐' },
              { id: 'Length', label: 'Length', icon: '📏' },
              { id: 'Bidirectional', label: 'Bi-Dir', icon: '✛' },
              { id: 'ArrowAnnotate', label: 'Arrow', icon: '↗️' },
              { id: 'EllipticalROI', label: 'Ellipse', icon: '⭕' },
              { id: 'RectangleROI', label: 'Rect', icon: '⬜' },
              { id: 'Angle', label: 'Angle', icon: '📐' },
              { id: 'MPR', label: 'MPR', icon: '🧊' },
              { id: 'Invert', label: 'Invert', icon: '◑' },
              { id: 'FlipHorizontal', label: 'Flip', icon: '↔️' },
              { id: 'RotateRight', label: 'Rotate', icon: '↻' },
              { id: 'Reset', label: 'Reset View', icon: '🔄' },
              { id: 'Fullscreen', label: isFullscreen ? 'Exit Full' : 'Fullscreen', icon: isFullscreen ? '✖️' : '🔲' }
            ].map(tool => (
              <button
                key={tool.id}
                onClick={() => handleToolSelect(tool.id)}
                className="flex flex-col items-center justify-center p-2 rounded-lg bg-[#1e2235] text-gray-300 hover:bg-[#3a3f99]"
              >
                <span className="text-xl mb-1">{tool.icon}</span>
                <span className="text-[10px] text-center font-medium uppercase tracking-wider">{tool.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Panels (Menu) Sheet */}
      {isPanelsOpen && (
        <div className="mobile-sheet absolute bottom-[70px] left-0 right-0 bg-[#090c14] border-t border-[#3a3f99] shadow-[0_-10px_30px_rgba(0,0,0,0.8)] z-[10005] rounded-t-xl p-4 transition-transform duration-300 transform translate-y-0 pointer-events-auto">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-white font-semibold text-sm">Menu</h3>
            <button onClick={() => setIsPanelsOpen(false)} className="text-gray-400 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: '@ohif/extension-actecal-erp.panelModule.aiAnalysis', label: 'AI Analysis' },
              { id: '@ohif/extension-cornerstone.panelModule.panelMeasurement', label: 'Measurements' },
              { id: '@ohif/extension-cornerstone.panelModule.panelSegmentation', label: 'Segmentation' },
              { id: '@ohif/extension-actecal-erp.panelModule.activeUsers', label: 'Active Users' },
              { id: '@ohif/extension-actecal-erp.panelModule.notes', label: 'Notes' },
              { id: '@ohif/extension-actecal-erp.panelModule.annotationFilters', label: 'View Filters' },
            ].map(panel => (
              <button
                key={panel.id}
                onClick={() => activateRightPanelTab(panel.id)}
                className="flex flex-col items-center justify-center p-3 rounded-lg bg-[#1e2235] text-gray-300 hover:bg-[#3a3f99]"
              >
                <span className="text-[11px] text-center font-medium mt-1 leading-tight">{panel.label}</span>
              </button>
            ))}
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('mobile-navigate-worklist')); setIsPanelsOpen(false); }}
              className="flex flex-col items-center justify-center p-3 rounded-lg bg-[#1e2235] text-gray-300 hover:bg-[#3a3f99]"
            >
              <span className="text-[11px] text-center font-medium mt-1 leading-tight">Worklist</span>
            </button>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('mobile-show-shortcuts')); setIsPanelsOpen(false); }}
              className="flex flex-col items-center justify-center p-3 rounded-lg bg-[#1e2235] text-gray-300 hover:bg-[#3a3f99]"
            >
              <span className="text-[11px] text-center font-medium mt-1 leading-tight">Shortcuts</span>
            </button>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('mobile-show-about')); setIsPanelsOpen(false); }}
              className="flex flex-col items-center justify-center p-3 rounded-lg bg-[#1e2235] text-gray-300 hover:bg-[#3a3f99]"
            >
              <span className="text-[11px] text-center font-medium mt-1 leading-tight">About</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Bottom Nav Bar - 5 Buttons */}
      <div className="mobile-nav-bar absolute bottom-0 left-0 right-0 bg-[#090c14] border-t border-[#3a3f99] p-2 pb-safe pointer-events-auto flex justify-between items-center px-2 shadow-[0_-5px_20px_rgba(0,0,0,0.5)] h-[70px]">
        
        {/* 1. STUDIES */}
        <button 
          onClick={toggleStudiesPanel}
          className={`flex flex-col items-center justify-center p-1 w-[20%] ${isLeftPanelOpen ? 'text-[#5b65d6]' : 'text-gray-400 hover:text-white'}`}
        >
          <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16m-7 6h7" /></svg>
          <span className="text-[9px] font-medium tracking-wide">STUDIES</span>
        </button>

        {/* 2. VIEWER */}
        <button 
          onClick={showViewer}
          className={`flex flex-col items-center justify-center p-1 w-[20%] ${!isLeftPanelOpen && !isRightPanelOpen && !isToolsOpen && !isPanelsOpen ? 'text-[#5b65d6]' : 'text-gray-400 hover:text-white'}`}
        >
          <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-[9px] font-medium tracking-wide">VIEWER</span>
        </button>

        {/* 3. TOOLS */}
        <button 
          onClick={toggleToolsSheet}
          className={`flex flex-col items-center justify-center p-1 w-[20%] ${isToolsOpen ? 'text-[#5b65d6]' : 'text-gray-400 hover:text-white'}`}
        >
          <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg>
          <span className="text-[9px] font-medium tracking-wide">TOOLS</span>
        </button>

        {/* 4. REPORT */}
        <button 
          onClick={toggleEditorPanel}
          className={`flex flex-col items-center justify-center p-1 w-[20%] ${isRightPanelOpen ? 'text-[#5b65d6]' : 'text-gray-400 hover:text-white'}`}
        >
          <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          <span className="text-[9px] font-medium tracking-wide">REPORT</span>
        </button>

        {/* 5. MENU */}
        <button 
          onClick={togglePanelsSheet}
          className={`flex flex-col items-center justify-center p-1 w-[20%] ${isPanelsOpen ? 'text-[#5b65d6]' : 'text-gray-400 hover:text-white'}`}
        >
          <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
          <span className="text-[9px] font-medium tracking-wide">MENU</span>
        </button>
      </div>
    </div>
  );

  const location = useLocation();
  const isWorklist = location.pathname === '/' || location.pathname === '';

  if (!isMobile || isWorklist) return null;

  return ReactDOM.createPortal(NavContent, document.body);
}

export default MobileBottomNav;
