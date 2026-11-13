// Installers for Spectra Desktop (electron-builder): macOS dmg and zip, a Windows NSIS installer, Linux AppImage and
// deb. Test builds are unsigned (ad-hoc on macOS). With certificates in the environment they are signed, and
// notarized on macOS. The Microsoft Store package and the update feed come with the accounts (TASK_PLAN 13, phase 5).
// GitHub Actions passes secrets that are not set as empty strings, and electron-builder would then try to sign
// with an empty certificate path, so empty counts as not set.
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
  if (process.env[name] === '') delete process.env[name];
}
const signedMac = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = signedMac && Boolean(process.env.APPLE_TEAM_ID && (process.env.APPLE_API_KEY || process.env.APPLE_ID));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.actecal.spectra.desktop',
  productName: 'Spectra Desktop',
  copyright: 'Copyright © 2026 Actecal Private Limited',
  directories: { output: 'release', buildResources: 'build' },
  files: [
    'src/**/*',
    'app/viewer/**/*',
    'package.json',
    // dcmjs ships three builds with their source maps; the main process loads build/dcmjs.js only.
    '!**/*.map',
    '!node_modules/dcmjs/build/dcmjs.es.js',
    '!node_modules/dcmjs/build/dcmjs.min.js',
  ],
  // The viewer is built on the OHIF Viewer, whose MIT licence asks for its notice in copies.
  extraResources: [{ from: '../LICENSE', to: 'LICENSE-OHIF.txt' }],
  asar: true,
  artifactName: 'Spectra-Desktop-${version}-${os}-${arch}.${ext}',
  // Electron features this app does not use are switched off, so that its binary cannot be reused as a Node.js runtime.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // The app loads from app://, never file://.
    grantFileProtocolExtraPrivileges: false,
  },
  fileAssociations: [{ ext: ['dcm', 'dicom'], name: 'DICOM file', description: 'DICOM medical image', mimeType: 'application/dicom', role: 'Viewer' }],
  mac: {
    category: 'public.app-category.medical',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    // The hardened runtime is what notarization needs. Ad-hoc test builds go without it: with it, macOS library
    // validation would stop an ad-hoc-signed Electron app from starting.
    hardenedRuntime: signedMac,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    identity: signedMac ? undefined : '-',
    notarize,
    // Finder: "Open With" for DICOM files, and folders and ZIP files dropped on the Dock icon, without becoming
    // their default app.
    extendInfo: {
      CFBundleDocumentTypes: [
        { CFBundleTypeName: 'DICOM file', CFBundleTypeRole: 'Viewer', CFBundleTypeExtensions: ['dcm', 'dicom'], CFBundleTypeMIMETypes: ['application/dicom'], LSHandlerRank: 'Default' },
        { CFBundleTypeName: 'Folder', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.folder'], LSHandlerRank: 'Alternate' },
        { CFBundleTypeName: 'ZIP archive', CFBundleTypeRole: 'Viewer', LSItemContentTypes: ['public.zip-archive'], LSHandlerRank: 'Alternate' },
      ],
    },
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Graphics',
    maintainer: 'Actecal <sales@actecal.com>',
    synopsis: 'Free DICOM viewer',
    mimeTypes: ['application/dicom'],
  },
  publish: null,
};
