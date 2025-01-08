const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();


const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
// Custom error handling for JSON parsing
app.use(express.json({
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON payload' });
      throw new Error('Invalid JSON payload');
    }
  }
}));

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  next();
});

// Database connection with better error handling
let db;
try {
  db = new sqlite3.Database('./football.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
      process.exit(1);
    }
    console.log('Connected to SQLite database');

    db.run(`
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        opponent TEXT NOT NULL,
        score TEXT NOT NULL,
        scorers TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS next_match (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        opponent TEXT NOT NULL,
        time TEXT NOT NULL
      )
    `);
  });
} catch (err) {
  console.error('Failed to initialize database:', err);
  process.exit(1);
}

// Improved input validation middleware
const validateMatch = (req, res, next) => {
  const { date, opponent, score } = req.body;

  if (!date || !opponent || !score) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Stricter date validation
  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  // Stricter score validation
  if (!/^\d{1,2}-\d{1,2}$/.test(score)) {
    return res.status(400).json({ error: 'Invalid score format. Use X-Y (max 2 digits)' });
  }

  next();
};

// Add validation middleware for next match
const validateNextMatch = (req, res, next) => {
  const { date, opponent, time } = req.body;

  if (!date || !opponent || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  if (!/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM' });
  }

  next();
};

// Improved password validation
const validatePassword = (req, res, next) => {
  const { password } = req.headers;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden: Unauthorized access' });
  }
  next();
};

// Routes
app.post('/authenticate', (req, res) => {
  const { password } = req.body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Forbidden: Invalid password' });
  }

  res.json({ message: 'Authentication successful' });
});



app.get('/matches', (req, res) => {
  db.all('SELECT * FROM matches ORDER BY date DESC', [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json(rows);
  });
});

app.post('/matches', validatePassword, validateMatch, (req, res) => {
  const { date, opponent, score, scorers } = req.body;

  db.serialize(() => {
    const sql = 'INSERT INTO matches (date, opponent, score, scorers) VALUES (?, ?, ?, ?)';
    db.run(sql, [date, opponent, score, scorers || null], function (err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to add match' });
      }
      res.status(201).json({
        id: this.lastID,
        message: 'Match added successfully'
      });
    });
  });
});

app.delete('/matches/:id', validatePassword, (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid match ID' });
  }

  db.serialize(() => {
    const sql = 'DELETE FROM matches WHERE id = ?';
    db.run(sql, [id], function (err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to delete match' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }
      res.json({ message: 'Match deleted successfully' });
    });
  });
});

app.get('/next-match', (req, res) => {
  db.get('SELECT * FROM next_match ORDER BY id DESC LIMIT 1', [], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json(row || null);
  });
});

app.post('/next-match', validatePassword, validateNextMatch, (req, res) => {
  const { date, opponent, time } = req.body;

  db.serialize(() => {
    db.run('DELETE FROM next_match', [], function (err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to update next match' });
      }

      const sql = 'INSERT INTO next_match (date, opponent, time) VALUES (?, ?, ?)';
      db.run(sql, [date, opponent, time], function (err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to add next match' });
        } ``
        res.status(201).json({
          id: this.lastID,
          message: 'Next match updated successfully'
        });
      });
    });
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Server start
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
