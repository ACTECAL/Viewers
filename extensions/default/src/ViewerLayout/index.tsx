import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

import { InvestigationalUseDialog } from '@ohif/ui-next';
import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding, ResizablePanelGroup, ResizablePanel, ResizableHandle, Button, Icons } from '@ohif/ui-next';
import useResizablePanels from './ResizablePanelsHook';

const resizableHandleClassName = 'mt-[1px] bg-background';

function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
  leftPanelResizable = false,
  rightPanelResizable = false,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();

  const { panelService, hangingProtocolService, customizationService, uiNotificationService } = servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      if (!isFS) {
        // Automatically restore panels when exiting fullscreen (e.g., via ESC key)
        setLeftPanelClosed(false);
        setRightPanelClosed(false);
      }
    };

    const handleKeyDown = (e) => {
      console.log('Key pressed:', e.key, 'Target:', e.target.tagName, 'ContentEditable:', e.target.isContentEditable);
      // Toggle fullscreen on 'f' or 'F' if not focusing an input or contenteditable element
      if ((e.key === 'f' || e.key === 'F') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
        e.preventDefault();
        const isFS = !!document.fullscreenElement;
        const panelsClosed = leftPanelClosedState && rightPanelClosedState;

        if (!isFS) {
          // State 0 -> State 1: Enter FS, hide panels
          document.documentElement.requestFullscreen().catch((err) => {
            console.warn(`Error attempting to enable fullscreen mode: ${err.message}`);
          });
          setLeftPanelClosed(true);
          setRightPanelClosed(true);
        } else if (isFS && panelsClosed) {
          // State 1 -> State 2: Stay FS, show panels
          setLeftPanelClosed(false);
          setRightPanelClosed(false);
        } else {
          // State 2 -> State 0: Exit FS, show panels
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
          setLeftPanelClosed(false);
          setRightPanelClosed(false);
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [leftPanelClosedState, rightPanelClosedState]);

  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
  ] = useResizablePanels(
    leftPanelClosed,
    setLeftPanelClosed,
    rightPanelClosed,
    setRightPanelClosed,
    hasLeftPanels,
    hasRightPanels,
    leftPanelInitialExpandedWidth,
    rightPanelInitialExpandedWidth,
    leftPanelMinimumExpandedWidth,
    rightPanelMinimumExpandedWidth
  );

  const handleMouseEnter = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-background');
    document.body.classList.add('overflow-hidden');

    return () => {
      document.body.classList.remove('bg-background');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry || !entry.component) {
      throw new Error(
        `${id} is not valid for an extension module or no component found from extension ${id}. Please verify your configuration or ensure that the extension is properly registered. It's also possible that your mode is utilizing a module from an extension that hasn't been included in its dependencies (add the extension to the "extensionDependencies" array in your mode's index.js file). Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry };
  };

  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      HangingProtocolService.EVENTS.PROTOCOL_CHANGED,

      // Todo: right now to set the loading indicator to false, we need to wait for the
      // hangingProtocolService to finish applying the viewport matching to each viewport,
      // however, this might not be the only approach to set the loading indicator to false. we need to explore this further.
      () => {
        setShowLoadingIndicator(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hangingProtocolService]);

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  const [activeRightPanelId, setActiveRightPanelId] = useState<string | null>(null);

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );

    const handleTabChange = (e: any) => {
      if (e.detail.side === 'right') {
        setActiveRightPanelId(e.detail.panelId);
      }
    };

    const handleMobileToggleLeft = (e: any) => {
      if (e.detail?.forceClose) {
        setLeftPanelClosed(true);
      } else if (e.detail?.forceOpen) {
        setLeftPanelClosed(false);
        setRightPanelClosed(true); // Close right panel if open
      } else {
        setLeftPanelClosed(prev => !prev);
        setRightPanelClosed(true); // Close right panel if open
      }
    };

    const handleMobileToggleRight = (e: any) => {
      if (e.detail?.forceClose) {
        setRightPanelClosed(true);
      } else if (e.detail?.forceOpen) {
        setRightPanelClosed(false);
        setLeftPanelClosed(true); // Close left panel if open
      } else {
        setRightPanelClosed(prev => !prev);
        setLeftPanelClosed(true); // Close left panel if open
      }
    };

    window.addEventListener('panel-tab-changed', handleTabChange);
    window.addEventListener('toggle-mobile-left-panel', handleMobileToggleLeft);
    window.addEventListener('toggle-mobile-right-panel', handleMobileToggleRight);
    
    const handleMobileActivateTab = (e: any) => {
      if (e.detail?.panelId) {
        panelService.activatePanel(e.detail.panelId);
      }
    };
    window.addEventListener('activate-mobile-panel-tab', handleMobileActivateTab);

    return () => {
      unsubscribe();
      window.removeEventListener('panel-tab-changed', handleTabChange);
      window.removeEventListener('toggle-mobile-left-panel', handleMobileToggleLeft);
      window.removeEventListener('toggle-mobile-right-panel', handleMobileToggleRight);
      window.removeEventListener('activate-mobile-panel-tab', handleMobileActivateTab);
    };
  }, [panelService, hasPanels]);

  // Force close panels on mobile load
  useEffect(() => {
    if (window.innerWidth < 1200) {
      const timer = setTimeout(() => {
        setLeftPanelClosed(true);
        setRightPanelClosed(true);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const viewportComponents = viewports.map(getViewportComponentData);

  const isZenMode = isFullscreen && leftPanelClosedState && rightPanelClosedState;

  const handleSubmitReport = useCallback(async () => {
    try {
      const studyInstanceUID = viewports[0]?.displaySetsToDisplay?.[0]?.StudyInstanceUID;
      const response = await fetch(`${appConfig.apiBaseUrl}/erp/autolight/dicom/worklist/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ StudyInstanceUID: studyInstanceUID, status: 'REPORTED' })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (window.opener) {
        window.close();
      } else {
        window.location.href = '/';
      }
    } catch (err) {
      console.error('Failed to submit report', err);
      uiNotificationService.show({
        title: 'Submit Failed',
        message: 'Report not submitted',
        type: 'error',
      });
    }
  }, [viewports, appConfig, uiNotificationService]);

  useEffect(() => {
    const handleTrigger = () => handleSubmitReport();
    window.addEventListener('trigger-submit-report', handleTrigger);
    return () => window.removeEventListener('trigger-submit-report', handleTrigger);
  }, [handleSubmitReport]);

  useEffect(() => {
    const handleRelogin = () => {
      const { uiDialogService } = servicesManager.services;
      const ReloginDialogContent = ({ hide }: { hide?: () => void }) => (
        <div className="flex flex-col gap-4">
          <p className="text-gray-300">Your session has expired or is unauthenticated. Please login again to continue.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button onClick={() => {
               hide?.();
               window.location.reload();
            }} className="bg-[#5b65d6] hover:bg-[#4a54c4] text-white">
              Login
            </Button>
          </div>
        </div>
      );

      uiDialogService.show({
        content: ReloginDialogContent,
        title: 'Session Expired',
      });
    };

    window.addEventListener('trigger-relogin', handleRelogin);
    return () => window.removeEventListener('trigger-relogin', handleRelogin);
  }, [servicesManager]);

  return (
    <div>
      {!isZenMode && (
        <ViewerHeader
          hotkeysManager={hotkeysManager}
          extensionManager={extensionManager}
          servicesManager={servicesManager}
          appConfig={appConfig}
        />
      )}
      {isZenMode && (
        <div
          className="absolute top-0 left-0 w-full z-50 transition-transform duration-300 ease-in-out"
          style={{ transform: isHeaderHovered ? 'translateY(0)' : 'translateY(calc(-100% + 12px))', opacity: isHeaderHovered ? 1 : 0 }}
          onMouseEnter={() => setIsHeaderHovered(true)}
          onMouseLeave={() => setIsHeaderHovered(false)}
        >
          {/* Invisible trigger zone at the very bottom so it remains easy to hover when hidden */}
          {!isHeaderHovered && <div className="absolute bottom-0 w-full h-[12px] cursor-pointer" />}
          <ViewerHeader
            hotkeysManager={hotkeysManager}
            extensionManager={extensionManager}
            servicesManager={servicesManager}
            appConfig={appConfig}
          />
        </div>
      )}
      <div
        className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-background"
        style={{ height: isZenMode ? '100vh' : 'calc(100vh - 52px)' }}
      >
        <React.Fragment>
          {showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-background" />}
          <ResizablePanelGroup {...resizablePanelGroupProps}>
            {/* LEFT SIDEPANELS */}
            {hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps} className="relative">
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            {/* TOOLBAR + GRID */}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className="flex h-full flex-1 flex-col">
                <div
                  className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-background"
                  onMouseEnter={handleMouseEnter}
                >
                  <ViewportGridComp
                    servicesManager={servicesManager}
                    viewportComponents={viewportComponents}
                    commandsManager={commandsManager}
                  />
                </div>
              </div>
            </ResizablePanel>
            {hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps} className="relative">
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </React.Fragment>
      </div>
      <Onboarding tours={customizationService.getCustomization('ohif.tours')} />
      <InvestigationalUseDialog dialogConfiguration={appConfig?.investigationalUseDialog} />
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object.isRequired,
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelClosed: PropTypes.bool.isRequired,
  rightPanelClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  viewports: PropTypes.array,
};

export default ViewerLayout;
