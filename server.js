const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const BOOKINGS_FILE = path.join(ROOT, 'camera-rental-bookings.csv');
const PRODUCT = 'Sony ZV-E10';

const HEADERS = [
  'submitted_at',
  'booking_id',
  'status',
  'product',
  'plan',
  'start_date',
  'end_date',
  'rental_days',
  'total_php',
  'pickup_time',
  'shoot_type',
  'full_name',
  'phone',
  'email',
  'social',
  'notes'
];

const PLANS = {
  day: { label: 'Day Rate', price: 800, unitDays: 1 },
  'two-day': { label: '2-Day Kit', price: 1500, unitDays: 2 },
  week: { label: '7-Day Kit', price: 4500, unitDays: 7 }
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8'
};

function ensureBookingsFile() {
  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, `${HEADERS.join(',')}\n`, 'utf8');
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function csv(value) {
  return `"${String(value ?? '').replaceAll('"', '""').replace(/\r?\n/g, ' ')}"`;
}

function clean(value, limit = 180) {
  return String(value ?? '').trim().slice(0, limit);
}

function calculateDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate || startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

function createBooking(input) {
  const plan = PLANS[input.ratePlan] || PLANS.day;
  const startDate = clean(input.startDate, 20);
  const endDate = clean(input.endDate || input.startDate, 20);
  const days = calculateDays(startDate, endDate);
  const units = Math.ceil(days / plan.unitDays);
  const total = units * plan.price;

  return {
    submitted_at: new Date().toISOString(),
    booking_id: `RF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    status: 'Pending confirmation',
    product: PRODUCT,
    plan: plan.label,
    start_date: startDate,
    end_date: endDate,
    rental_days: days,
    total_php: total,
    pickup_time: clean(input.pickupTime, 20),
    shoot_type: clean(input.shootType, 80),
    full_name: clean(input.fullName, 120),
    phone: clean(input.phone, 60),
    email: clean(input.email, 120),
    social: clean(input.social, 160),
    notes: clean(input.notes, 600)
  };
}

function validate(booking) {
  const required = ['start_date', 'end_date', 'pickup_time', 'shoot_type', 'full_name', 'phone', 'email'];
  const missing = required.filter(key => !booking[key]);
  if (missing.length) return `Missing fields: ${missing.join(', ')}`;
  if (!booking.email.includes('@')) return 'Email address is invalid';
  return '';
}

async function handleBooking(req, res) {
  try {
    const input = await readJson(req);
    const booking = createBooking(input);
    const error = validate(booking);
    if (error) {
      send(res, 400, JSON.stringify({ ok: false, error }));
      return;
    }

    ensureBookingsFile();
    const row = HEADERS.map(key => csv(booking[key])).join(',');
    fs.appendFileSync(BOOKINGS_FILE, `${row}\n`, 'utf8');

    send(res, 200, JSON.stringify({
      ok: true,
      bookingId: booking.booking_id,
      total: booking.total_php,
      file: path.basename(BOOKINGS_FILE)
    }));
  } catch (error) {
    send(res, 500, JSON.stringify({ ok: false, error: error.message || 'Server error' }));
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${requested}`);

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }

    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/bookings') {
    handleBooking(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }

  send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
});

ensureBookingsFile();
server.listen(PORT, () => {
  console.log(`RebenFilms rental server running at http://localhost:${PORT}`);
});
