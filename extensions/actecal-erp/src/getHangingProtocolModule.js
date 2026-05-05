export default function getHangingProtocolModule() {
  return [
    {
      id: 'actecal-erp-protocol',
      name: 'ACTECAL ERP Protocol',
      protocolMatchingRules: [
        {
          id: 'two-study-layout',
          weight: 1,
          attribute: 'StudyInstanceUID',
          constraint: {
            equals: true,
          },
        },
      ],
      displaySets: [
        {
          id: 'two-study-layout',
          viewportStructure: {
            layoutType: 'grid',
            properties: {
              rows: 2,
              columns: 1,
            },
          },
        },
      ],
    },
  ];
}
