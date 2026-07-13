require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { ensureDb } = require('./db');
const notify = require('./notify');

ensureDb();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-please',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 hours
}));

// Make current path available to all views for nav highlighting
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.isAuthed = !!(req.session && req.session.isAdmin);
  next();
});

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/login');
}

app.use('/', require('./routes/auth'));

app.use('/', requireAuth, require('./routes/dashboard'));
app.use('/bookings', requireAuth, require('./routes/bookings'));
app.use('/tables', requireAuth, require('./routes/tables'));
app.use('/menu', requireAuth, require('./routes/menu'));
app.use('/calendar', requireAuth, require('./routes/calendar'));
app.use('/notifications', requireAuth, require('./routes/notifications'));
app.use('/settings', requireAuth, require('./routes/settings'));

app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`Bar & Restaurant Booking admin running at http://localhost:${PORT}`);
  notify.startScheduler();
});
