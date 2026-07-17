require('dotenv').config();
const express = require('express');
const cors = require('cors');
const propertiesRouter = require('./routes/properties');

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/properties', propertiesRouter);

app.listen(process.env.PORT, () => console.log('Server running on port ' + process.env.PORT));