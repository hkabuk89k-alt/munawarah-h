import { put, list } from '@vercel/blob';

const DB_FILE = 'manora-db.json';
const DEFAULT_DB = {
  adminPassword: '789686358',
  categories: ['أدوية', 'عناية بطفل', 'عناية بالأم', 'تجميل', 'أدوات طبية'],
  categoryImages: {},
  products: [],
  banners: [],
  customers: [],
  orders: []
};

async function getDatabase() {
  const { blobs } = await list({ prefix: DB_FILE });
  if (blobs.length === 0) {
    return { ...DEFAULT_DB };
  }
  // جلب أحدث نسخة من قاعدة البيانات دون تخزين مؤقت (Cache)
  const latestBlob = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const response = await fetch(`${latestBlob.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) return { ...DEFAULT_DB };
  const data = await response.json();
  return { ...DEFAULT_DB, ...data };
}

export default async function handler(req, res) {
  // السماح بالطلبات
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. جلب البيانات (للمتجر ولوحة التحكم)
    if (req.method === 'GET') {
      const db = await getDatabase();
      // إخفاء كلمة مرور الأدمن عن المتصفح العام للعملاء
      const isAdmin = req.query.admin === '1';
      if (!isAdmin) {
        const { adminPassword, ...publicDb } = db;
        return res.status(200).json(publicDb);
      }
      return res.status(200).json(db);
    }

    // 2. حفظ البيانات أو رفع صورة
    if (req.method === 'POST') {
      const { action, payload } = req.body;

      // رفع صورة إلى Vercel Blob وإرجاع رابطها
      if (action === 'uploadImage') {
        const { base64, filename } = payload;
        const matches = base64.match(/^data:(.+);base64,(.+)$/);
        if (!matches) return res.status(400).json({ error: 'صيغة الصورة غير صالحة' });
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const blob = await put(`images/${Date.now()}-${filename || 'img.png'}`, buffer, {
          access: 'public',
          contentType
        });
        return res.status(200).json({ url: blob.url });
      }

      // تحديث كامل من لوحة التحكم (بعد التحقق من كلمة المرور)
      if (action === 'saveAdminDB') {
        const currentDb = await getDatabase();
        if (payload.authPassword !== currentDb.adminPassword) {
          return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
        }
        const { authPassword, ...newDbData } = payload;
        await put(DB_FILE, JSON.stringify(newDbData), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json'
        });
        return res.status(200).json({ success: true });
      }

      // تسجيل عميل جديد من المتجر
      if (action === 'signup') {
        const db = await getDatabase();
        if (db.customers.some(c => c.username === payload.username)) {
          return res.status(400).json({ error: 'اسم المستخدم مستخدم مسبقاً' });
        }
        db.customers.push(payload);
        await put(DB_FILE, JSON.stringify(db), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json'
        });
        return res.status(200).json({ success: true });
      }

      // إرسال طلب جديد من المتجر
      if (action === 'newOrder') {
        const db = await getDatabase();
        db.orders.push(payload);
        await put(DB_FILE, JSON.stringify(db), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json'
        });
        return res.status(200).json({ success: true });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'حدث خطأ في السيرفر' });
  }
}
