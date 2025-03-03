// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const dotenv = require('dotenv');

// Ładowanie zmiennych środowiskowych
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'wyzwanie2025-secret-key';
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/wyzwanie2025';

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// MongoDB Models
const userSchema = new mongoose.Schema({
  stravaId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['runner', 'cyclist', 'combined'], required: true },
  avatar: String,
  points: { type: Number, default: 0 },
  runDistance: { type: Number, default: 0 },
  rideDistance: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  tokens: {
    accessToken: String,
    refreshToken: String,
    expiresAt: Number
  },
  createdAt: { type: Date, default: Date.now }
});

const activitySchema = new mongoose.Schema({
  stravaId: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: String,
  type: { type: String, enum: ['run', 'ride'] },
  distance: Number,
  date: Date,
  pace: Number,
  speed: Number,
  highFives: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Activity = mongoose.model('Activity', activitySchema);

// Middleware do autoryzacji
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ success: false, message: 'Brak tokenu autoryzacji' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Nieprawidłowy token' });
    req.user = user;
    next();
  });
};

// Połączenie z bazą danych
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Połączono z bazą danych MongoDB'))
  .catch(err => console.error('Błąd połączenia z MongoDB:', err));

// Routes
// Endpoint dla wymiany kodu autoryzacji na token
app.post('/auth/exchange-token', async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    
    // Żądanie do Strava API w celu wymiany kodu na token
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code'
    });
    
    const { access_token, refresh_token, expires_at, athlete } = response.data;
    
    // Sprawdź, czy użytkownik już istnieje
    let user = await User.findOne({ stravaId: athlete.id.toString() });
    
    if (!user) {
      // Nowy użytkownik - zostanie utworzony przy rejestracji
      // Zwracamy token z API Strava
      return res.json({
        access_token,
        refresh_token,
        expires_at
      });
    }
    
    // Aktualizuj tokeny użytkownika
    user.tokens = {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: expires_at
    };
    await user.save();
    
    // Utwórz token JWT
    const token = jwt.sign({ id: user._id, stravaId: user.stravaId }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      access_token,
      refresh_token,
      expires_at,
      token
    });
  } catch (error) {
    console.error('Błąd wymiany tokenu:', error);
    res.status(500).json({ success: false, message: 'Błąd wymiany tokenu', error: error.message });
  }
});

// Endpoint dla odświeżania tokenu
app.post('/auth/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: refresh_token,
      grant_type: 'refresh_token'
    });
    
    res.json({
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: response.data.expires_at
    });
  } catch (error) {
    console.error('Błąd odświeżania tokenu:', error);
    res.status(500).json({ success: false, message: 'Błąd odświeżania tokenu', error: error.message });
  }
});

// Endpoint dla weryfikacji tokenu
app.post('/auth/verify-token', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Użytkownik nie znaleziony' });
    }
    
    res.json({
      success: true,
      user: {
        id: `strava-${user.stravaId}`,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        points: user.points,
        runDistance: user.runDistance,
        rideDistance: user.rideDistance,
        streak: user.streak,
        stravaId: user.stravaId
      }
    });
  } catch (error) {
    console.error('Błąd weryfikacji tokenu:', error);
    res.status(500).json({ success: false, message: 'Błąd weryfikacji tokenu', error: error.message });
  }
});

// Endpoint do tworzenia użytkownika
app.post('/users', async (req, res) => {
  try {
    const { user: userData } = req.body;
    
    // Sprawdź, czy użytkownik już istnieje
    let user = await User.findOne({ stravaId: userData.stravaId.toString() });
    
    if (user) {
      // Aktualizuj istniejącego użytkownika
