import React from 'react';
import classNames from 'classnames';

import ProgressLoadingBar from '../ProgressLoadingBar';
import { Icons } from '../Icons';
/**
 *  A React component that renders a loading indicator.
 * if progress is not provided, it will render an infinite loading indicator
 * if progress is provided, it will render a progress bar
 * Optionally a textBlock can be provided to display a message
 */
function LoadingIndicatorProgress({ className, textBlock, progress }) {
  return (
    <div
      className={classNames(
        'absolute top-0 left-0 z-50 flex h-full w-full flex-col items-center justify-center space-y-5',
        className
      )}
    >
      <Icons.LoadingOHIFMark className="text-foreground h-32 w-auto" />
    </div>
  );
}

export default LoadingIndicatorProgress;
