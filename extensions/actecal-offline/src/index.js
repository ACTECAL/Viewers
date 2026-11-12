// @ohif/extension-actecal-offline: the public offline edition of Actecal Spectra
// (https://spectra.actecal.com/offline/, config/offline.js, pluginConfig.offline.json).
// - customizationModule.offlineViewer: home page for files, folders and ZIPs; friendly 404 and reload pages.
// - commandsModule.showSpectraPremium: dialog for a locked premium feature.
// - panelModule.spectraPremium: right-hand panel listing the premium features.
// It makes no network requests; premium buttons only link to Actecal sign-up and contact pages.
import React from 'react';
import { id } from './id';
import OfflineHome from './components/OfflineHome';
import { PremiumModal, PremiumPanel } from './components/PremiumContent';
import { premiumFeature } from './premium';

function getCustomizationModule() {
  // createElement, not JSX: this repo's Babel setup parses JSX only in .jsx and .tsx files.
  const withNotice = notice =>
    function OfflineNotice(props) {
      return React.createElement(OfflineHome, { ...props, notice });
    };
  return [
    {
      name: 'offlineViewer',
      value: {
        // Custom routes come before the baked-in ones, so these replace /local, /localbasic and /notfoundstudy.
        'routes.customRoutes': {
          routes: {
            $push: [
              { path: '/', children: OfflineHome },
              { path: '/local', children: OfflineHome },
              { path: '/localbasic', children: OfflineHome },
              // Mode validation lands here after a reload, when the in-memory study is gone.
              { path: '/notfoundstudy', children: withNotice('reloaded') },
            ],
          },
          notFoundRoute: { $set: { path: '*', children: withNotice('notfound') } },
        },
      },
    },
  ];
}

function getCommandsModule({ servicesManager }) {
  const actions = {
    showSpectraPremium: ({ feature } = {}) => {
      const { uiModalService } = servicesManager.services;
      const item = premiumFeature(feature);
      uiModalService.show({
        content: PremiumModal,
        title: item ? `${item.title} is part of Actecal Spectra` : 'Actecal Spectra',
        contentProps: { feature: item },
        containerClassName: 'max-w-md',
      });
    },
  };
  return {
    actions,
    defaultContext: 'VIEWER',
    definitions: {
      showSpectraPremium: { commandFn: actions.showSpectraPremium },
    },
  };
}

function getPanelModule() {
  return [
    {
      name: 'spectraPremium',
      iconName: 'status-locked',
      iconLabel: 'Spectra',
      label: 'Actecal Spectra',
      component: PremiumPanel,
    },
  ];
}

export default {
  id,
  getCustomizationModule,
  getCommandsModule,
  getPanelModule,
};
