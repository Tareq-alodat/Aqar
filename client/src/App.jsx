import { useEffect, useState } from 'react';

function App() {
  const [status, setStatus] = useState('checking...');

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/health`)
      .then(res => res.json())
      .then(data => setStatus(JSON.stringify(data)))
      .catch(err => setStatus('Error: ' + err.message));
  }, []);

  return (
    <div>
      <h1>Backend status:</h1>
      <p>{status}</p>
    </div>
  );
}

export default App;