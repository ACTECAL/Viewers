import React, { useState, useEffect } from 'react';
import { Input, Button, Typography, Tabs, Tab } from '@ohif/ui-next';
import ApiService from '../services/ApiService';

function ShareModal({ studyInstanceUid, hide }) {
  const [tab, setTab] = useState('internal');
  const [doctors, setDoctors] = useState([]);
  const [formData, setFormData] = useState({});
  const [signedUrl, setSignedUrl] = useState(null);

  useEffect(() => {
    if (tab === 'internal') {
      ApiService.getDoctors().then(setDoctors);
    }
  }, [tab]);

  const handleSubmit = async () => {
    const response = await ApiService.shareStudy({ studyInstanceUid, ...formData });
    if (response.signedUrl) {
      setSignedUrl(response.signedUrl);
    }
  };

  return (
    <div className="p-4">
      <Tabs value={tab} onValueChange={setTab}>
        <Tab value="internal">Internal Team</Tab>
        <Tab value="external">External Expert</Tab>
      </Tabs>
      {tab === 'internal' && (
        <div>
          <Typography>Choose a doctor:</Typography>
          <select
            onChange={e => setFormData({ ...formData, doctorId: e.target.value })}
            className="w-full p-2 border"
          >
            {doctors.map(doctor => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {tab === 'external' && (
        <div>
          <Input
            label="Name"
            onChange={e => setFormData({ ...formData, name: e.target.value })}
          />
          <Input
            label="Email"
            onChange={e => setFormData({ ...formData, email: e.target.value })}
          />
          <Input
            label="WhatsApp"
            onChange={e => setFormData({ ...formData, whatsapp: e.target.value })}
          />
        </div>
      )}
      {signedUrl ? (
        <div>
          <Typography>Shareable Link:</Typography>
          <Input value={signedUrl} readOnly />
          <Button onClick={() => navigator.clipboard.writeText(signedUrl)}>Copy to Clipboard</Button>
        </div>
      ) : (
        <Button onClick={handleSubmit}>Submit</Button>
      )}
    </div>
  );
}

export default ShareModal;
