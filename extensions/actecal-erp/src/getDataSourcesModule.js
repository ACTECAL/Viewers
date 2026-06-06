import { utils } from '@ohif/core';

/**
 * Custom Data Source for the Actecal ERP backend worklist.
 */
function createActecalApiDataSource(actecalConfig, userAuthenticationService) {
  const { apiBaseUrl } = window.config; // e.g. https://api-dev.actecal.com

  return {
    name: 'actecalApi',
    type: 'webApi',
    implementation: {
      initialize: ({ params, query }) => {
        // Initialization if needed
      },
      query: {
        studies: {
          search: async (params) => {
            const userId = localStorage.getItem('actecal_userId');
            
            // Construct the URL
            let url = `${apiBaseUrl}/erp/autolight/dicom/worklist`;
            if (userId) {
              url += `?userId=${userId}`;
            }

            // In Phase 1-C, we also cache the token and dicomStorePath here.
            
            try {
              const response = await fetch(url, {
                method: 'GET',
                credentials: 'include', // Ensures session cookies are sent
                headers: {
                  'Content-Type': 'application/json',
                },
              });

              if (!response.ok) {
                throw new Error(`Failed to fetch worklist: ${response.statusText}`);
              }

              const data = await response.json();
              
              // We need to map Actecal JSON to OHIF Study format.
              // Schema: erprefid, studyinstanceid, name, dob, gender, type
              
              const mappedStudies = data.map((item) => {
                
                // Phase 1-C: Cache the GCP token and dicomStorePath
                if (item.studyinstanceid) {
                    const cacheKey = `actecal_cache_${item.studyinstanceid}`;
                    const cachePayload = {
                        dicomStorePath: item.dicomStorePath,
                        token: item.gcpToken
                    };
                    sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
                }

                return {
                  studyInstanceUid: item.studyinstanceid,
                  date: item.studyDate || '', // Try to find a date or fallback
                  time: item.studyTime || '',
                  patientName: item.name || '',
                  patientId: item.erprefid || '',
                  accession: item.accessionNumber || '',
                  patientAge: item.dob ? calculateAge(item.dob) : '', // Would need a helper
                  patientSex: item.gender || '',
                  patientBirthdate: item.dob || '',
                  modalities: item.type || '',
                  instances: item.instances || 0,
                  description: item.description || '',
                  // any other required fields for OHIF list
                };
              });

              return mappedStudies;
            } catch (error) {
              console.error('Error fetching Actecal Worklist:', error);
              return [];
            }
          },
        },
      },
      retrieve: {
         // The actual image retrieval will STILL be handled by the default OHIF DICOMweb data source!
         // Wait, the worklist uses one data source, but the viewer mode might use another.
         // Or does the viewer mode use the same data source?
      }
    },
  };
}

function calculateAge(dobString) {
    if (!dobString) return '';
    const dob = new Date(dobString);
    const diff_ms = Date.now() - dob.getTime();
    const age_dt = new Date(diff_ms); 
    return Math.abs(age_dt.getUTCFullYear() - 1970).toString() + 'Y';
}

function getDataSourcesModule({ servicesManager, extensionManager }) {
  const { userAuthenticationService } = servicesManager.services;
  return [
    {
      name: 'actecalApi',
      type: 'webApi',
      createDataSource: (configuration) => {
        return createActecalApiDataSource(configuration, userAuthenticationService);
      },
    },
  ];
}

export default getDataSourcesModule;
