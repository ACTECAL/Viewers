import React, { useState, useEffect } from 'react';
import usePatientInfo from '../../hooks/usePatientInfo';
import { Icons } from '@ohif/ui-next';

export enum PatientInfoVisibility {
  VISIBLE = 'visible',
  VISIBLE_COLLAPSED = 'visibleCollapsed',
  DISABLED = 'disabled',
  VISIBLE_READONLY = 'visibleReadOnly',
}

const formatWithEllipsis = (str, maxLength) => {
  if (str?.length > maxLength) {
    return str.substring(0, maxLength) + '...';
  }
  return str;
};

function HeaderPatientInfo({ servicesManager, appConfig }: withAppTypes) {
  const { patientInfo, isMixedPatients } = usePatientInfo(servicesManager);

  const formattedPatientName = formatWithEllipsis(patientInfo.PatientName, 27);
  const formattedPatientID = formatWithEllipsis(patientInfo.PatientID, 15);

  return (
    <div className="flex items-center justify-center gap-2 rounded-lg px-2">
      {isMixedPatients ? (
        <Icons.MultiplePatients className="text-primary w-5 h-5" />
      ) : (
        <Icons.Patient className="text-primary w-5 h-5" />
      )}
      <div className="flex flex-col justify-center">
        {!isMixedPatients ? (
          <>
            <div className="text-foreground self-start text-[13px] font-bold">
              {formattedPatientName}
            </div>
            <div className="text-muted-foreground flex gap-2 text-[11px]">
              <div>{formattedPatientID}</div>
              <div>{patientInfo.PatientSex}</div>
              <div>{patientInfo.PatientDOB}</div>
            </div>
          </>
        ) : (
          <div className="text-foreground self-center text-[13px] font-bold">
            Multiple Patients
          </div>
        )}
      </div>
    </div>
  );
}

export default HeaderPatientInfo;
