import { useState, useEffect } from 'react';
import { utils, useSystem } from '@ohif/core';

const { formatPN, formatDate } = utils;

function usePatientInfo() {
  const { servicesManager } = useSystem();
  const { displaySetService } = servicesManager.services;

  const [patientInfo, setPatientInfo] = useState({
    PatientName: '',
    PatientID: '',
    PatientSex: '',
    PatientDOB: '',
  });
  const [isMixedPatients, setIsMixedPatients] = useState(false);

  const checkMixedPatients = (referenceInstance) => {
    const displaySets = displaySetService.getActiveDisplaySets();
    let isMixedPatients = false;
    displaySets.forEach(displaySet => {
      const instance = displaySet?.instances?.[0] || displaySet?.instance;
      if (!instance) {
        return;
      }
      
      const isSameID = instance.PatientID === referenceInstance.PatientID;
      const isSameNameAndDOB = 
        instance.PatientName && referenceInstance.PatientName &&
        formatPN(instance.PatientName) === formatPN(referenceInstance.PatientName) && 
        instance.PatientBirthDate === referenceInstance.PatientBirthDate;

      // They are only mixed if NEITHER the ID nor the Name+DOB match
      if (!isSameID && !isSameNameAndDOB) {
        isMixedPatients = true;
      }
    });
    setIsMixedPatients(isMixedPatients);
  };

  const updatePatientInfo = ({ displaySetsAdded }) => {
    if (!displaySetsAdded.length) {
      return;
    }
    const displaySet = displaySetsAdded[0];
    const instance = displaySet?.instances?.[0] || displaySet?.instance;
    if (!instance) {
      return;
    }

    setPatientInfo({
      PatientID: instance.PatientID || null,
      PatientName: instance.PatientName ? formatPN(instance.PatientName) : null,
      PatientSex: instance.PatientSex || null,
      PatientDOB: formatDate(instance.PatientBirthDate) || null,
    });
    checkMixedPatients(instance);
  };

  useEffect(() => {
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      props => updatePatientInfo(props)
    );
    return () => subscription.unsubscribe();
  }, []);

  return { patientInfo, isMixedPatients };
}

export default usePatientInfo;
