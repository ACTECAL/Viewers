// @ohif/mode-actecal-offline: the viewer of the public offline edition (route /offline/viewer/dicomlocal).
// It is the upstream basic mode (no measurement-tracking prompts; tag browser under More tools) plus
// locked Spectra features: three toolbar buttons and a right-hand panel from @ohif/extension-actecal-offline.
// It does not depend on @ohif/extension-actecal-erp, so it never calls the ERP API.
import { ToolbarService } from '@ohif/core';
import {
  basicLayout,
  basicRoute,
  cornerstone,
  extensionDependencies as basicDependencies,
  mode as basicMode,
  modeInstance as basicModeInstance,
  toolbarButtons as basicButtons,
  toolbarSections as basicSections,
} from '@ohif/mode-basic';
import { id } from './id';

const { TOOLBAR_SECTIONS } = ToolbarService;
const OFFLINE_EXTENSION = '@ohif/extension-actecal-offline';

const premiumButtons = [
  { id: 'SpectraPremiumAI', label: 'AI analysis', icon: 'tab-segmentation', feature: 'ai' },
  { id: 'SpectraPremiumReport', label: 'Report', icon: 'icon-list-view', feature: 'report' },
  { id: 'SpectraPremiumShare', label: 'Share', icon: 'icon-link', feature: 'share' },
].map(button => ({
  id: button.id,
  uiType: 'ohif.toolButton',
  props: {
    icon: button.icon,
    label: button.label,
    tooltip: `${button.label}: available in Actecal Spectra`,
    commands: { commandName: 'showSpectraPremium', commandOptions: { feature: button.feature } },
    evaluate: 'evaluate.action',
  },
}));

export const extensionDependencies = {
  ...basicDependencies,
  [OFFLINE_EXTENSION]: '^1.0.0',
};

const offlineLayout = {
  ...basicLayout,
  props: {
    ...basicLayout.props,
    rightPanels: [cornerstone.measurements, cornerstone.segmentation, `${OFFLINE_EXTENSION}.panelModule.spectraPremium`],
    rightPanelClosed: true,
  },
};

export const modeInstance = {
  ...basicModeInstance,
  id,
  routeName: 'viewer',
  displayName: 'Spectra free viewer',
  hide: false,
  routes: [{ ...basicRoute, path: 'viewer', layoutInstance: offlineLayout }],
  extensions: extensionDependencies,
  toolbarButtons: [...basicButtons, ...premiumButtons],
  toolbarSections: {
    ...basicSections,
    [TOOLBAR_SECTIONS.primary]: [...basicSections[TOOLBAR_SECTIONS.primary], ...premiumButtons.map(button => button.id)],
  },
};

const mode = {
  ...basicMode,
  id,
  modeInstance,
  extensionDependencies,
};

export default mode;
