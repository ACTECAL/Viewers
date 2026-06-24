import React, { ReactNode } from 'react';
import classNames from 'classnames';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
  ToolButton,
} from '../';
import { IconPresentationProvider } from '@ohif/ui-next';

import NavBar from '../NavBar';

// Todo: we should move this component to composition and remove props base

interface HeaderProps {
  children?: ReactNode;
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;
  isReturnEnabled?: boolean;
  onClickReturnButton?: () => void;
  isSticky?: boolean;
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };
  PatientInfo?: ReactNode;
  Secondary?: ReactNode;
  UndoRedo?: ReactNode;
}

function Header({
  children,
  menuOptions,
  isReturnEnabled = true,
  onClickReturnButton,
  isSticky = false,
  WhiteLabeling,
  PatientInfo,
  UndoRedo,
  Secondary,
  ...props
}: HeaderProps): ReactNode {
  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <IconPresentationProvider
      size="large"
      IconContainer={ToolButton}
    >
        <NavBar
          isSticky={isSticky}
          className="mobile-desktop-header"
          {...props}
        >
        <div className="relative h-[48px] items-center">
          <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center">
            
            {/* MOBILE ONLY: SVG Logo */}
            <div className="md:hidden flex items-center ml-2 relative z-50 pointer-events-auto">
              <div className="w-8 h-8 opacity-80 cursor-pointer">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="w-full h-full">
                  <rect x="15" y="40" width="10" height="20" rx="5" fill="#5ACCE6" opacity="0.6" />
                  <rect x="35" y="25" width="10" height="50" rx="5" fill="#0D6EFD" opacity="0.8" />
                  <rect x="55" y="10" width="10" height="80" rx="5" fill="#FFFFFF" />
                  <rect x="75" y="30" width="10" height="40" rx="5" fill="#5ACCE6" />
                </svg>
              </div>
              <div className="flex flex-col justify-center ml-1">
                <span className="text-[18px] font-bold text-white leading-none tracking-widest">SPECTRA</span>
              </div>
            </div>

            {/* DESKTOP ONLY: Original Logo & Back Button */}
            <div
              className={classNames(
                'mr-3 hidden md:inline-flex items-center',
                isReturnEnabled && 'cursor-pointer'
              )}
              onClick={onClickReturn}
              data-cy="return-to-work-list"
            >
              {isReturnEnabled && <Icons.ArrowLeft className="text-primary ml-1 h-7 w-7" />}
              <div className="ml-1">
                {WhiteLabeling?.createLogoComponentFn?.(React, props) || <Icons.OHIFLogo />}
              </div>
            </div>
          </div>
          
          <div className="absolute top-1/2 left-[250px] h-8 -translate-y-1/2 hidden md:block">{Secondary}</div>
          
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform hidden md:block">
            <div className="flex items-center justify-center space-x-2">{children}</div>
          </div>
          
          <div className="absolute right-0 top-1/2 flex -translate-y-1/2 select-none items-center pr-2 md:pr-0">
            <div className="hidden md:flex items-center">
              {UndoRedo}
            </div>
            <div className="border-muted mx-1.5 h-[25px] border-r hidden md:block"></div>
            
            {/* Constrain Patient Name to 40% width on mobile */}
            <div className="w-[40vw] md:w-auto md:max-w-none overflow-hidden">
              {PatientInfo}
            </div>
            
            <div className="border-muted mx-1.5 h-[25px] border-r hidden md:block"></div>
            <div className="flex-shrink-0 hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:bg-muted mt-2 h-full w-full"
                  >
                    <Icons.GearSettings />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuOptions.map((option, index) => {
                    const IconComponent = option.icon
                      ? Icons[option.icon as keyof typeof Icons]
                      : null;
                    return (
                      <DropdownMenuItem
                        key={index}
                        onSelect={option.onClick}
                        className="flex items-center gap-2 py-2"
                      >
                        {IconComponent && (
                          <span className="flex h-4 w-4 items-center justify-center">
                            <Icons.ByName name={option.icon} />
                          </span>
                        )}
                        <span className="flex-1">{option.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </NavBar>
    </IconPresentationProvider>
  );
}

export default Header;
