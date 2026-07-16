const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'auva-70253' });
const db = admin.firestore();

const ZAKI_URL = 'https://receivecommission-qa7rumslba-uc.a.run.app';
const API_KEY = 'zk-comm-R8xP4wL9mN2vT6qJ3yF7aB5cD0eG1hK';

async function run() {
  console.log('Loading all COMPLETED deliveries from Taksometr...');
  const snap = await db.collection('deliveries').where('status', '==', 'COMPLETED').get();
  console.log('Found:', snap.size, 'completed deliveries');

  let sent = 0, skip = 0, errors = 0, duplicates = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const c = d.commission || 0;
    if (c <= 0) { skip++; continue; }

    const completedAt = d.endTime
      ? new Date(d.endTime).toISOString()
      : d.createdAt
        ? new Date(d.createdAt).toISOString()
        : new Date().toISOString();

    const payload = {
      source: 'taksometr',
      orderId: doc.id,
      driverId: d.courierId || '',
      driverName: d.courierName || 'Неизвестный',
      commissionAmount: c,
      orderAmount: d.cost || 0,
      commissionPercent: d.cost > 0 ? Math.round((c / d.cost) * 1000) / 10 : 0,
      orderType: d.deliveryType || 'default',
      completedAt: completedAt,
    };

    try {
      const r = await fetch(ZAKI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const body = await r.json();
        if (body.duplicate) { duplicates++; } else { sent++; }
        if ((sent + duplicates) % 100 === 0) console.log(`  Progress: sent=${sent} dup=${duplicates}...`);
      } else {
        errors++;
        if (errors <= 5) console.error('  Error', r.status, 'for', doc.id);
      }
    } catch (e) {
      errors++;
      if (errors <= 5) console.error('  Exception for', doc.id, e.message);
    }

    if (sent % 30 === 0) await new Promise(r => setTimeout(r, 50));
  }

  console.log('');
  console.log('=== DONE ===');
  console.log('Sent (new):', sent);
  console.log('Duplicates (already existed):', duplicates);
  console.log('Skipped (commission=0):', skip);
  console.log('Errors:', errors);
  process.exit(0);
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
