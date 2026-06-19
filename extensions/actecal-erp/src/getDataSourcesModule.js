import { utils, IWebApiDataSource } from '@ohif/core';

/**
 * Custom Data Source for the Actecal ERP backend worklist.
 */
function createActecalApiDataSource(actecalConfig, userAuthenticationService, extensionManager) {
  const { apiBaseUrl } = window.config; // e.g. https://api-dev.actecal.com

  const getDelegate = () => extensionManager.getDataSources('ohif')?.[0];

  const implementation = {
    initialize: async ({ params, query }) => {
      const uids = implementation.getStudyInstanceUIDs({ params, query });
      if (!uids || uids.length === 0) return;
      
      const studyInstanceUid = uids[0];
      const cacheKey = `actecal_cache_${studyInstanceUid}`;
      const cachedData = sessionStorage.getItem(cacheKey);

      let token = null;
      let dicomStorePath = null;

      if (cachedData) {
         try {
             const parsed = JSON.parse(cachedData);
             dicomStorePath = parsed.dicomStorePath;
             
             // Check if the token is still valid (give a 5 minute buffer)
             if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt - 300000) {
                 token = parsed.token;
             }
         } catch (e) {}
      }

      if (!token || !dicomStorePath) {
          const userId = localStorage.getItem('actecal_userId');
          const { apiBaseUrl, tenant } = window.config;
          const baseUrl = `${apiBaseUrl}/erp/${tenant}/dicom`;
          
          try {
             const headers = { 'x-user-id': userId };
             const guestToken = sessionStorage.getItem('actecal_guestToken');
             if (guestToken) headers['Authorization'] = `Bearer ${guestToken}`;

             const [contextRes, tokenRes] = await Promise.all([
                 fetch(`${baseUrl}/studies/context?uids=${studyInstanceUid}`, { credentials: 'include', headers }),
                 fetch(`${baseUrl}/gcp-token?uids=${studyInstanceUid}`, { credentials: 'include', headers })
             ]);
             
             if (contextRes.ok && tokenRes.ok) {
                 const contexts = await contextRes.json();
                 const tokenData = await tokenRes.json();
                 
                 if (contexts && contexts.studies && contexts.studies.length > 0) {
                     dicomStorePath = contexts.studies[0].dicom_store_path;
                 } else {
                     dicomStorePath = contexts.dicomStorePath;
                 }
                 token = tokenData.access_token;
                 
                 // Store token with its expiry time (expires_in is in seconds)
                 const expiresIn = tokenData.expires_in || 3600; 
                 const expiresAt = Date.now() + (expiresIn * 1000);
                 
                 sessionStorage.setItem(cacheKey, JSON.stringify({ token, dicomStorePath, expiresAt }));
             }
          } catch (e) {
             console.error("Failed to fetch context/token in data source initialize", e);
          }
      }

      if (token && dicomStorePath) {
          const gcpUrl = `https://healthcare.googleapis.com/v1/${dicomStorePath}/dicomWeb`;
          
          if (userAuthenticationService) {
            userAuthenticationService.setServiceImplementation({
              getAuthorizationHeader: () => {
                 const cacheKey = `actecal_cache_${studyInstanceUid}`;
                 const cachedData = sessionStorage.getItem(cacheKey);
                 let currentToken = token;
                 if (cachedData) {
                    try {
                        const parsed = JSON.parse(cachedData);
                        if (parsed.token && (!parsed.expiresAt || Date.now() < parsed.expiresAt - 60000)) {
                            currentToken = parsed.token;
                        } else if (parsed.expiresAt && Date.now() >= parsed.expiresAt - 60000) {
                            console.warn("⚠️ getAuthorizationHeader: Cache token expired, using old instance token.");
                        }
                    } catch (e) {}
                 }
                 return { Authorization: `Bearer ${currentToken}` };
              }
            });
            console.log("✅ Injected GCP Token into userAuthenticationService via actecalApi initialize");

            // Setup a background refresh to prevent the token from expiring if the user leaves the tab open
            if (window._gcpTokenRefreshInterval) {
                clearInterval(window._gcpTokenRefreshInterval);
            }
            window._gcpTokenRefreshInterval = setInterval(() => {
                const cacheKey = `actecal_cache_${studyInstanceUid}`;
                const userId = localStorage.getItem('actecal_userId');
                const { apiBaseUrl, tenant } = window.config;
                const baseUrl = `${apiBaseUrl}/erp/${tenant}/dicom`;
                const headers = { 'x-user-id': userId };
                const guestToken = sessionStorage.getItem('actecal_guestToken');
                if (guestToken) headers['Authorization'] = `Bearer ${guestToken}`;
                
                fetch(`${baseUrl}/gcp-token?uids=${studyInstanceUid}`, { credentials: 'include', headers })
                .then(res => res.json())
                .then(tokenData => {
                    const newToken = tokenData.access_token;
                    if (newToken) {
                        const expiresIn = tokenData.expires_in || 3600; 
                        const expiresAt = Date.now() + (expiresIn * 1000);
                        const cachedData = sessionStorage.getItem(cacheKey);
                        let dicomStorePath = null;
                        if (cachedData) {
                            try { dicomStorePath = JSON.parse(cachedData).dicomStorePath; } catch (e) {}
                        }
                        sessionStorage.setItem(cacheKey, JSON.stringify({ token: newToken, dicomStorePath, expiresAt }));
                        console.log("✅ Interval refreshed GCP token in background");
                    }
                }).catch(e => console.error("Background token refresh failed", e));
            }, 45 * 60 * 1000); // 45 minutes
          }
          
          if (extensionManager && extensionManager.dataSourceDefs['ohif']) {
             const existingConfig = extensionManager.dataSourceDefs['ohif'].configuration;
             extensionManager.updateDataSourceConfiguration(
               "ohif",
               {
                 ...existingConfig,
                 wadoUriRoot: gcpUrl,
                 qidoRoot: gcpUrl,
                 wadoRoot: gcpUrl,
               }
             );
             console.log("✅ Updated ohif data source configuration with dicomStorePath");
          }
      }

      // Important: We must explicitly initialize the OHIF delegate data source
      // so it configures its getAuthorizationHeader and DICOMWeb clients using the new config.
      const delegate = getDelegate();
      if (delegate && delegate.initialize) {
         await delegate.initialize({ params, query });
         console.log("✅ Initialized ohif delegate data source");
      }
    },
    query: {
      studies: {
        search: async (params) => {
          // If OHIF is asking for a specific study (e.g. for the Viewer) or a specific patient, fetch from GCP directly
          if (params?.studyInstanceUid || params?.StudyInstanceUID || params?.StudyInstanceUIDs || params?.patientId || params?.PatientID) {
              try {
                  const uidStr = params?.studyInstanceUid || params?.StudyInstanceUID || params?.StudyInstanceUIDs;
                  const normalizedParams = { ...params };
                  if (uidStr) {
                      normalizedParams.studyInstanceUid = Array.isArray(uidStr) ? uidStr[0] : uidStr;
                  }
                  const results = await getDelegate().query.studies.search(normalizedParams);
                  if (results && results.length > 0) {
                      return results;
                  }
                  console.warn("GCP returned empty study search, falling back to basic object");
              } catch (e) {
                  console.error("GCP study search failed, falling back to basic object", e);
              }
              
              // Fallback so the OHIF StudyBrowser left panel doesn't crash/render empty
              const uids = params?.studyInstanceUid || params?.StudyInstanceUID || params?.StudyInstanceUIDs;
              const uidStr = Array.isArray(uids) ? uids[0] : uids;
              
              if (!uidStr) {
                  return []; // If it was a patient search and it failed, return empty array
              }

              return [{
                  studyInstanceUid: uidStr,
                  patientName: 'Unknown',
                  date: '',
                  description: '',
                  modalities: '',
                  instances: 0,
                  time: '',
                  mrn: params?.patientId || params?.PatientID || '',
                  accession: ''
              }];
          }

          const userId = localStorage.getItem('actecal_userId');
          
          // Construct the URL
          let url = `${apiBaseUrl}/erp/autolight/dicom/worklist`;
          if (userId) {
            url += `?userId=${userId}`;
          }

          try {
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
            });

            if (!response.ok) {
              throw new Error(`Failed to fetch worklist: ${response.statusText}`);
            }

            const data = await response.json();
            
            const mappedStudies = data.map((item) => {
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
                date: item.studyDate || '', 
                time: item.studyTime || '',
                patientName: item.name || '',
                patientId: item.erprefid || '',
                accession: item.accessionNumber || '',
                patientAge: item.dob ? calculateAge(item.dob) : '',
                patientSex: item.gender || '',
                patientBirthdate: item.dob || '',
                modalities: item.type || '',
                instances: item.instances || 0,
                description: item.description || '',
              };
            });

            return mappedStudies;
          } catch (error) {
            console.error('Error fetching Actecal Worklist:', error);
            return [];
          }
        },
      },
      series: {
        search: (...args) => getDelegate().query.series.search(...args),
      },
      instances: {
        search: (...args) => getDelegate().query.instances.search(...args),
      },
    },
    retrieve: {
      series: {
        metadata: async (...args) => getDelegate().retrieve.series.metadata(...args),
      },
      directURL: (...args) => getDelegate().retrieve.directURL(...args),
      getGetThumbnailSrc: (...args) => getDelegate().retrieve.getGetThumbnailSrc(...args),
      getWadoDicomWebClient: (...args) => getDelegate().retrieve.getWadoDicomWebClient(...args),
      bulkDataURI: (...args) => getDelegate().retrieve.bulkDataURI(...args),
    },
    getImageIdsForDisplaySet: (...args) => getDelegate()?.getImageIdsForDisplaySet?.(...args),
    getImageIdsForInstance: (...args) => getDelegate()?.getImageIdsForInstance?.(...args),
    deleteStudyMetadataPromise: (...args) => getDelegate()?.deleteStudyMetadataPromise?.(...args),
    store: {
      dicom: (...args) => getDelegate().store.dicom(...args),
    },
    reject: {
      series: (...args) => getDelegate()?.reject?.series?.(...args),
    },
    getConfig: () => actecalConfig || {},
    getStudyInstanceUIDs: ({ params, query }) => {
      const paramsStudyInstanceUIDs = params.StudyInstanceUIDs || params.studyInstanceUIDs || params.StudyInstanceUID || params.studyInstanceUID;

      const queryStudyInstanceUIDs = utils.splitComma(
        query.getAll('StudyInstanceUIDs')
          .concat(query.getAll('studyInstanceUIDs'))
          .concat(query.getAll('StudyInstanceUID'))
          .concat(query.getAll('studyInstanceUID'))
      );

      const StudyInstanceUIDs =
        (queryStudyInstanceUIDs.length && queryStudyInstanceUIDs) || paramsStudyInstanceUIDs;
      const StudyInstanceUIDsAsArray =
        StudyInstanceUIDs && Array.isArray(StudyInstanceUIDs)
          ? StudyInstanceUIDs
          : [StudyInstanceUIDs];

      return StudyInstanceUIDsAsArray;
    },
  };

  return IWebApiDataSource.create(implementation);
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
        return createActecalApiDataSource(configuration, userAuthenticationService, extensionManager);
      },
    },
  ];
}

export default getDataSourcesModule;
