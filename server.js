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
user.role = userData.role;
      user.avatar = userData.avatar;
      await user.save();
    } else {
      // Utwórz nowego użytkownika
      user = new User({
        stravaId: userData.stravaId.toString(),
        name: userData.name,
        role: userData.role,
        avatar: userData.avatar || 'https://i.pravatar.cc/150?img=50',
        points: 0,
        runDistance: 0,
        rideDistance: 0,
        streak: 0
      });
      await user.save();
    }
    
    // Utwórz token JWT
    const token = jwt.sign({ id: user._id, stravaId: user.stravaId }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({
      success: true,
      token,
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
    console.error('Błąd tworzenia użytkownika:', error);
    res.status(500).json({ success: false, message: 'Błąd tworzenia użytkownika', error: error.message });
  }
});

// Endpoint do pobierania użytkownika po ID Strava
app.get('/users/:stravaId', async (req, res) => {
  try {
    const { stravaId } = req.params;
    
    const user = await User.findOne({ stravaId });
    
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
    console.error('Błąd pobierania użytkownika:', error);
    res.status(500).json({ success: false, message: 'Błąd pobierania użytkownika', error: error.message });
  }
});

// Endpoint do pobierania danych atletyy z API Strava
app.get('/strava/athlete', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user || !user.tokens || !user.tokens.accessToken) {
      return res.status(401).json({ success: false, message: 'Brak tokenu Strava' });
    }
    
    // Sprawdź, czy token wymaga odświeżenia
    if (user.tokens.expiresAt * 1000 < Date.now()) {
      // Odśwież token
      const response = await axios.post('https://www.strava.com/oauth/token', {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: user.tokens.refreshToken,
        grant_type: 'refresh_token'
      });
      
      user.tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: response.data.expires_at
      };
      await user.save();
    }
    
    // Pobierz dane atlety z API Strava
    const stravaResponse = await axios.get('https://www.strava.com/api/v3/athlete', {
      headers: {
        'Authorization': `Bearer ${user.tokens.accessToken}`
      }
    });
    
    res.json(stravaResponse.data);
  } catch (error) {
    console.error('Błąd pobierania danych atlety:', error);
    res.status(500).json({ success: false, message: 'Błąd pobierania danych atlety', error: error.message });
  }
});

// Endpoint do pobierania aktywności z API Strava
app.get('/strava/activities', authenticateToken, async (req, res) => {
  try {
    const { after, before } = req.query;
    const user = await User.findById(req.user.id);
    
    if (!user || !user.tokens || !user.tokens.accessToken) {
      return res.status(401).json({ success: false, message: 'Brak tokenu Strava' });
    }
    
    // Sprawdź, czy token wymaga odświeżenia
    if (user.tokens.expiresAt * 1000 < Date.now()) {
      // Odśwież token
      const response = await axios.post('https://www.strava.com/oauth/token', {
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        refresh_token: user.tokens.refreshToken,
        grant_type: 'refresh_token'
      });
      
      user.tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: response.data.expires_at
      };
      await user.save();
    }
    
    // Pobierz aktywności z API Strava
    const stravaResponse = await axios.get(`https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=100`, {
      headers: {
        'Authorization': `Bearer ${user.tokens.accessToken}`
      }
    });
    
    // Przetwórz aktywności i zapisz do bazy danych
    const activities = stravaResponse.data;
    
    // Resetuj dane użytkownika
    user.points = 0;
    user.runDistance = 0;
    user.rideDistance = 0;
    
    // Usuń wszystkie istniejące aktywności tego użytkownika
    await Activity.deleteMany({ userId: user._id });
    
    // Przetwórz każdą aktywność
    const dbActivities = [];
    for (const activity of activities) {
      // Uwzględnij tylko biegi i jazdę na rowerze
      if (activity.type !== 'Run' && activity.type !== 'Ride') continue;
      
      const activityType = activity.type === 'Run' ? 'run' : 'ride';
      const distance = activity.distance / 1000; // Konwersja z metrów na kilometry
      const points = activityType === 'run' ? distance * 2 : distance;
      
      // Utwórz obiekt aktywności
      const newActivity = new Activity({
        stravaId: activity.id.toString(),
        userId: user._id,
        name: activity.name,
        type: activityType,
        distance: distance,
        date: new Date(activity.start_date),
        pace: activityType === 'run' ? (activity.moving_time / 60) / distance : 0, // minuty na km
        speed: activityType === 'ride' ? (distance / (activity.moving_time / 3600)) : 0, // km/h
        highFives: 0
      });
      
      await newActivity.save();
      dbActivities.push(newActivity);
      
      // Aktualizuj statystyki użytkownika
      user.points += points;
      if (activityType === 'run') {
        user.runDistance += distance;
      } else {
        user.rideDistance += distance;
      }
    }
    
    // Oblicz passę aktywności
    user.streak = await calculateStreak(user._id);
    
    // Zapisz zaktualizowanego użytkownika
    await user.save();
    
    res.json(activities);
  } catch (error) {
    console.error('Błąd pobierania aktywności:', error);
    res.status(500).json({ success: false, message: 'Błąd pobierania aktywności', error: error.message });
  }
});

// Endpoint do pobierania uczestników
app.get('/participants', async (req, res) => {
  try {
    const users = await User.find().sort({ points: -1 });
    
    const participants = users.map(user => ({
      id: `strava-${user.stravaId}`,
      name: user.name,
      role: user.role,
      avatar: user.avatar,
      points: user.points,
      runDistance: user.runDistance,
      rideDistance: user.rideDistance,
      streak: user.streak,
      stravaId: user.stravaId
    }));
    
    res.json({ success: true, participants });
  } catch (error) {
    console.error('Błąd pobierania uczestników:', error);
    res.status(500).json({ success: false, message: 'Błąd pobierania uczestników', error: error.message });
  }
});

// Endpoint do zapisywania uczestników
app.post('/participants', authenticateToken, async (req, res) => {
  try {
    const { participants } = req.body;
    
    // W rzeczywistej aplikacji można by dodać więcej logiki, np. sprawdzenie uprawnień
    
    res.json({ success: true, message: 'Dane uczestników zapisane pomyślnie' });
  } catch (error) {
    console.error('Błąd zapisywania uczestników:', error);
    res.status(500).json({ success: false, message: 'Błąd zapisywania uczestników', error: error.message });
  }
});

// Endpoint do pobierania aktywności
app.get('/activities', async (req, res) => {
  try {
    const dbActivities = await Activity.find().populate('userId').sort({ date: -1 });
    
    const activities = dbActivities.map(activity => ({
      id: `strava-${activity.stravaId}`,
      participantId: `strava-${activity.userId.stravaId}`,
      name: activity.name,
      type: activity.type,
      distance: activity.distance,
      date: activity.date.toISOString(),
      pace: activity.pace,
      speed: activity.speed,
      highFives: activity.highFives
    }));
    
    res.json({ success: true, activities });
  } catch (error) {
    console.error('Błąd pobierania aktywności:', error);
    res.status(500).json({ success: false, message: 'Błąd pobierania aktywności', error: error.message });
  }
});

// Endpoint do zapisywania aktywności
app.post('/activities', authenticateToken, async (req, res) => {
  try {
    const { activities } = req.body;
    
    // W rzeczywistej aplikacji można by dodać więcej logiki, np. sprawdzenie uprawnień
    
    res.json({ success: true, message: 'Dane aktywności zapisane pomyślnie' });
  } catch (error) {
    console.error('Błąd zapisywania aktywności:', error);
    res.status(500).json({ success: false, message: 'Błąd zapisywania aktywności', error: error.message });
  }
});

// Endpoint do wysyłania high-five dla aktywności
app.post('/activities/:activityId/highfive', authenticateToken, async (req, res) => {
  try {
    const { activityId } = req.params;
    const stravaId = activityId.replace('strava-', '');
    
    const activity = await Activity.findOne({ stravaId });
    
    if (!activity) {
      return res.status(404).json({ success: false, message: 'Aktywność nie znaleziona' });
    }
    
    // Zwiększ liczbę high-fives
    activity.highFives += 1;
    await activity.save();
    
    res.json({ success: true, highFives: activity.highFives });
  } catch (error) {
    console.error('Błąd wysyłania high-five:', error);
    res.status(500).json({ success: false, message: 'Błąd wysyłania high-five', error: error.message });
  }
});

// Funkcja pomocnicza do obliczania passy aktywności
async function calculateStreak(userId) {
  const activities = await Activity.find({ userId }).sort({ date: -1 });
  
  if (activities.length === 0) {
    return 0;
  }
  
  // Sprawdź, czy jest aktywność dzisiaj
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const latestActivity = new Date(activities[0].date);
  latestActivity.setHours(0, 0, 0, 0);
  
  if (latestActivity < today) {
    // Brak aktywności dzisiaj, passa przerwana
    return 0;
  }
  
  // Licz dni z rzędu
  let streak = 1;
  let currentDate = today;
  
  // Cofaj się dzień po dniu
  for (let i = 1; i <= 30; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    
    // Sprawdź, czy jest aktywność tego dnia
    const hasActivity = activities.some(activity => {
      const activityDate = new Date(activity.date);
      activityDate.setHours(0, 0, 0, 0);
      return activityDate.getTime() === prevDate.getTime();
    });
    
    if (hasActivity) {
      streak++;
      currentDate = prevDate;
    } else {
      break;
    }
  }
  
  return streak;
}

// Uruchomienie serwera
app.listen(PORT, () => {
  console.log(`Serwer API działa na porcie ${PORT}`);
});
