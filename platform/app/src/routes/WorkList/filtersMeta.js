import i18n from 'i18next';

const filtersMeta = [
  {
    name: 'mrn',
    displayName: 'Id',
    inputType: 'Text',
    isSortable: true,
    gridCol: 2,
  },
  {
    name: 'patientName',
    displayName: i18n.t('StudyList:PatientName'),
    inputType: 'Text',
    isSortable: true,
    gridCol: 3,
  },
  {
    name: 'patientAge',
    displayName: 'Age',
    inputType: 'None',
    isSortable: false,
    gridCol: 2,
  },
  {
    name: 'instances',
    displayName: 'Images',
    inputType: 'None',
    isSortable: false,
    gridCol: 2,
  },
  {
    name: 'status',
    displayName: 'Status',
    inputType: 'MultiSelect',
    inputProps: {
      options: [
        { value: 'ALL', label: 'ALL' },
        { value: 'CREATED', label: 'CREATED' },
        { value: 'HISTORY_CREATED', label: 'HISTORY_CREATED' },
        { value: 'SIGNED_OFF', label: 'SIGNED_OFF' },
        { value: 'LOCKED', label: 'LOCKED' },
        { value: 'DELETED', label: 'DELETED' },
      ],
    },
    isSortable: false,
    gridCol: 3,
  },
  {
    name: 'center',
    displayName: 'Center',
    inputType: 'None',
    isSortable: false,
    gridCol: 3,
  },
  {
    name: 'history',
    displayName: 'History',
    inputType: 'None',
    isSortable: false,
    gridCol: 3,
  },
  {
    name: 'studyDate',
    displayName: 'Date',
    inputType: 'DateRange',
    isSortable: true,
    gridCol: 3,
  },
  {
    name: 'report',
    displayName: 'Report',
    inputType: 'None',
    isSortable: false,
    gridCol: 1,
  },
  {
    name: 'share',
    displayName: 'Share',
    inputType: 'None',
    isSortable: false,
    gridCol: 1,
  },
  {
    name: 'actions',
    displayName: 'Actions',
    inputType: 'None',
    isSortable: false,
    gridCol: 1,
  },
];

export default filtersMeta;
