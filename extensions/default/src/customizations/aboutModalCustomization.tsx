import React from 'react';
import { AboutModal } from '@ohif/ui-next';
import detect from 'browser-detect';
import { useTranslation } from 'react-i18next';

function AboutModalDefault() {
  const { t } = useTranslation('AboutModal');
  const { os, version, name } = detect();
  
  // Safe substring fallback in case name is undefined
  const browserName = name ? `${name[0].toUpperCase()}${name.substring(1)}` : 'Unknown Browser';
  const browser = `${browserName} ${version || ''}`;
  
  const versionNumber = process.env.VERSION_NUMBER || '1.0.0';
  const commitHash = (process.env.COMMIT_HASH || 'dev').substring(0, 7);
  const [main, beta] = versionNumber.split('-');

  return (
    <AboutModal className="w-[450px]">
      <div className="flex flex-col items-center mb-6 mt-2">
        <div className="flex items-center space-x-3 mb-1">
           <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-10 h-10">
              <rect x="15" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.6"/>
              <rect x="35" y="25" width="10" height="50" rx="5" fill="#0D6EFD" opacity="0.8"/>
              <rect x="55" y="10" width="10" height="80" rx="5" fill="#FFFFFF"/>
              <rect x="75" y="30" width="10" height="40" rx="5" fill="#5ACCE6"/>
           </svg>
           <AboutModal.ProductName className="pt-0 text-3xl font-bold tracking-widest text-white">SPECTRA</AboutModal.ProductName>
        </div>
        <div className="text-muted-foreground text-xs tracking-widest font-medium uppercase mt-2 text-center">
          AI Powered Viewer
          <br/>
          Powered By ACTECAL
        </div>
      </div>
      
      <div className="border-t border-b border-border/50 py-4 mb-4">
        <AboutModal.Body className="my-0">
          <div className="grid grid-cols-2 gap-4 w-full text-center">
            <AboutModal.DetailItem
              label={t('Version')}
              value={`${main} ${beta ? `(${beta})` : ''}`}
            />
            <AboutModal.DetailItem
              label={t('Build Hash')}
              value={commitHash}
            />
          </div>
          <div className="w-[60%] h-px bg-border/30 mx-auto my-4" />
          <AboutModal.DetailItem
            label={t('System')}
            value={`${browser}, ${os}`}
          />
        </AboutModal.Body>
      </div>

      <div className="flex justify-center border-t border-border pt-4 pb-2">
        <AboutModal.SocialItem
          icon="ExternalLink"
          url="https://actecal.com"
          text="Visit actecal.com"
          className="text-primary hover:text-primary/80 transition-colors"
        />
      </div>
    </AboutModal>
  );
}

export default {
  'ohif.aboutModal': AboutModalDefault,
};
