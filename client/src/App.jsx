import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [properties, setProperties] = useState([]);
  const [form, setForm] = useState({
    owner_id: '',
    title: '',
    description: '',
    property_type: 'house',
    listed_price: '',
    area_sqm: '',
    city: '',
    district: ''
  });
  const [message, setMessage] = useState('');

  const fetchProperties = () => {
    fetch(`${API_URL}/api/properties`)
      .then(res => res.json())
      .then(setProperties)
      .catch(err => console.error(err));
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('Submitting...');
    try {
      const res = await fetch(`${API_URL}/api/properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!res.ok) throw new Error('Failed to create property');
      setMessage('Property created — pending admin review.');
      setForm({ owner_id: form.owner_id, title: '', description: '', property_type: 'house', listed_price: '', area_sqm: '', city: '', district: '' });
      fetchProperties();
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 20, fontFamily: 'sans-serif' }}>
      <h1>AQAR — Add Property</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input name="owner_id" placeholder="Owner ID (UUID)" value={form.owner_id} onChange={handleChange} required />
        <input name="title" placeholder="Title" value={form.title} onChange={handleChange} required />
        <textarea name="description" placeholder="Description" value={form.description} onChange={handleChange} />
        <select name="property_type" value={form.property_type} onChange={handleChange}>
          <option value="house">House</option>
          <option value="land">Land</option>
          <option value="apartment">Apartment</option>
          <option value="investment">Investment</option>
        </select>
        <input name="listed_price" type="number" placeholder="Listed Price" value={form.listed_price} onChange={handleChange} required />
        <input name="area_sqm" type="number" placeholder="Area (sqm)" value={form.area_sqm} onChange={handleChange} />
        <input name="city" placeholder="City" value={form.city} onChange={handleChange} />
        <input name="district" placeholder="District" value={form.district} onChange={handleChange} />
        <button type="submit">Create Property</button>
      </form>

      {message && <p>{message}</p>}

      <h2 style={{ marginTop: 40 }}>Active Properties</h2>
      {properties.length === 0 && <p>No active properties yet.</p>}
      <ul>
        {properties.map(p => (
          <li key={p.id} style={{ marginBottom: 10 }}>
            <strong>{p.title}</strong> — {p.city}, {p.district} — {p.listed_price} JOD
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;