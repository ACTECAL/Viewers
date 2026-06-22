import React, { useState, useEffect } from 'react';
import { Input, Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@ohif/ui-next';
import ApiService from '../services/ApiService';

function ShareModal({ studyInstanceUid, hide }) {
  const [tab, setTab] = useState('internal');
  const [doctors, setDoctors] = useState([]);
  const [formData, setFormData] = useState({});
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    if (tab === 'internal') {
      const api = new ApiService();
      api.getDoctors()
        .then(res => {
          if (Array.isArray(res)) {
            setDoctors(res);
          } else if (res && Array.isArray(res.data)) {
            setDoctors(res.data);
          } else if (res && Array.isArray(res.doctors)) {
            setDoctors(res.doctors);
          } else {
            console.warn("Unexpected getDoctors response:", res);
            setDoctors([]);
          }
        })
        .catch(err => {
          console.error(err);
          setDoctors([]);
        });
    }
  }, [tab]);

  const handleSubmit = async () => {
    try {
      const api = new ApiService();
      const response = await api.shareStudy({ studyInstanceUid, ...formData });
      if (response.signedUrl) {
        setSignedUrl(response.signedUrl);
      }
    } catch (e) {
      console.error("Failed to share study:", e);
    }
  };

  return (
    <div className="p-4 space-y-4 text-white">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full grid grid-cols-2 bg-muted/20 rounded-md">
          <TabsTrigger value="internal">Internal Team</TabsTrigger>
          <TabsTrigger value="external">External Expert</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {tab === 'internal' && (
        <div className="space-y-4">
          <p className="text-sm font-medium">Choose a doctor:</p>
          <select
            onChange={e => setFormData({ ...formData, doctorId: e.target.value })}
            className="w-full p-2 border border-input bg-background text-foreground rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select a doctor...</option>
            {Array.isArray(doctors) && doctors.map(doctor => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>
      )}
      
      {tab === 'external' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Name</p>
            <Input
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Email</p>
            <Input
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">WhatsApp</p>
            <Input
              onChange={e => setFormData({ ...formData, whatsapp: e.target.value })}
            />
          </div>
        </div>
      )}
      
      {signedUrl ? (
        <div className="space-y-4 pt-4">
          <p className="text-sm font-medium">Shareable Link:</p>
          <Input value={signedUrl} readOnly />
          <Button className="w-full" onClick={() => navigator.clipboard.writeText(signedUrl)}>
            Copy to Clipboard
          </Button>
        </div>
      ) : (
        <Button className="w-full mt-4" onClick={handleSubmit}>
          Submit
        </Button>
      )}
    </div>
  );
}

export default ShareModal;
