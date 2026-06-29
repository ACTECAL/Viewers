import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import HeaderPatientInfo from './HeaderPatientInfo';
import { PatientInfoVisibility } from './HeaderPatientInfo/HeaderPatientInfo';
import { preserveQueryParameters } from '@ohif/app';
import { Types } from '@ohif/core';
import { useUIModeStore } from '../stores/useUIModeStore';

const TIPS = [
  "Use [W] or [L] keys to quickly activate the Window/Level tool.",
  "Use [Arrow Keys] to scroll through the images in the viewport.",
  "Use [Z] for Zoom and [P] for Pan.",
  "You can invert the image colors by pressing [I].",
  "Press [Space] to instantly reset the viewport to its default state."
];

function ShortcutToast({ onClose, onShowPreferences }) {
  const [tipIndex] = useState(() => Math.floor(Math.random() * TIPS.length));

  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000); // Auto-hide after 5 seconds

    return () => clearTimeout(timer);
  }, [onClose]);

  return ReactDOM.createPortal(
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 99999 }} className="bg-[#161c2d] text-white p-4 rounded-lg shadow-lg max-w-sm border border-[#3a3f99] flex flex-col gap-3 transition-opacity duration-500">
      <div className="flex justify-between items-center mb-1">
        <h3 className="font-bold text-lg text-[#5b65d6]">Shortcut Tip</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <Icons.ByName name="close" className="w-4 h-4" />
        </button>
      </div>
      <p className="text-sm font-light leading-relaxed">{TIPS[tipIndex]}</p>
      <div className="flex justify-end mt-2">
        <button 
          onClick={() => {
            localStorage.setItem('hideShortcutToast', 'true');
            onClose();
          }} 
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Don't show this again
        </button>
      </div>
    </div>,
    document.body
  );
}

function ViewerHeader({ appConfig }: withAppTypes<{ appConfig: AppTypes.Config }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService } = servicesManager.services;

  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setMode } = useUIModeStore();

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    // The auto-fullscreen on first click has been disabled as requested by the user.
    // If they want fullscreen, they can click the manual toggle button.

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [location.search]);

  const [showShortcutToast, setShowShortcutToast] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!localStorage.getItem('hideShortcutToast') && window.innerWidth > 1200) {
        setShowShortcutToast(true);
        setTimeout(() => {
          setShowShortcutToast(false);
        }, 5000);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Error attempting to enable fullscreen mode: ${err.message}`);
      });
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  };

  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    
    // Explicitly preserve Actecal specific query parameters
    const currentQuery = new URLSearchParams(window.location.search);
    ['userId', 'tenant', 'sharecode'].forEach(key => {
      if (currentQuery.has(key)) {
        searchQuery.append(key, currentQuery.get(key));
      }
    });
    
    preserveQueryParameters(searchQuery);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show } = useModal();

  const AboutModal = customizationService.getCustomization(
    'ohif.aboutModal'
  ) as Types.MenuComponentCustomization;

  const UserPreferencesModal = customizationService.getCustomization(
    'ohif.userPreferencesModal'
  ) as Types.MenuComponentCustomization;

  const menuOptions = [
    {
      title: AboutModal?.menuTitle ?? t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: AboutModal?.title ?? '',
          containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
        }),
    },
    {
      title: UserPreferencesModal.menuTitle ?? t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          content: UserPreferencesModal,
          title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
          containerClassName:
            UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
        }),
    },
    {
      title: t('Header:Reset Shortcut Tips'),
      icon: 'info',
      onClick: () => {
        localStorage.removeItem('hideShortcutToast');
        setShowShortcutToast(true);
      }
    },
    {
      title: mode === 'simple' ? t('Header:Enable Diagnostic Mode') : t('Header:Enable Simple Mode'),
      icon: 'settings',
      onClick: () => {
        setMode(mode === 'simple' ? 'diagnostic' : 'simple');
      }
    },
  ];

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  // Handle Mobile events triggered from the MobileBottomNav
  useEffect(() => {
    const handleMobileNavigateHome = () => onClickReturnButton();
    const handleMobileShowAbout = () => {
      show({
        content: AboutModal,
        title: AboutModal?.title ?? '',
        containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
      });
    };
    const handleMobileShowPreferences = () => {
      show({
        content: UserPreferencesModal,
        title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
        containerClassName: UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
      });
    };

    window.addEventListener('mobile-navigate-worklist', handleMobileNavigateHome);
    window.addEventListener('mobile-show-about', handleMobileShowAbout);
    window.addEventListener('mobile-show-shortcuts', handleMobileShowPreferences);

    return () => {
      window.removeEventListener('mobile-navigate-worklist', handleMobileNavigateHome);
      window.removeEventListener('mobile-show-about', handleMobileShowAbout);
      window.removeEventListener('mobile-show-shortcuts', handleMobileShowPreferences);
    };
  }, [onClickReturnButton, show, AboutModal, UserPreferencesModal, t]);

  return (
    <Header
      menuOptions={menuOptions}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      Secondary={<Toolbar buttonSection="secondary" />}
      PatientInfo={
        appConfig.showPatientInfo !== PatientInfoVisibility.DISABLED && (
          <HeaderPatientInfo
            servicesManager={servicesManager}
            appConfig={appConfig}
          />
        )
      }
      UndoRedo={
        <div className="text-primary flex cursor-pointer items-center">
          <Button
            variant="ghost"
            className="hover:bg-muted"
            onClick={() => {
              commandsManager.run('undo');
            }}
          >
            <Icons.Undo className="" />
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-muted"
            onClick={() => {
              commandsManager.run('redo');
            }}
          >
            <Icons.Redo className="" />
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-muted"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Icons.ByName name="icon-tool-contract" className="w-5 h-5" /> : <Icons.ByName name="icon-tool-expand" className="w-5 h-5" />}
          </Button>
        </div>
      }
    >
      <div className="relative flex justify-center gap-[4px]">
        <Toolbar buttonSection="primary" />
      </div>
      {showShortcutToast && (
        <ShortcutToast
          onClose={() => setShowShortcutToast(false)}
          onShowPreferences={() => {
            show({
              content: UserPreferencesModal,
              title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
              containerClassName:
                UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
            });
            setShowShortcutToast(false);
          }}
        />
      )}
    </Header>
  );
}

export default ViewerHeader;
