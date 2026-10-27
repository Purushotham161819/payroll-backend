const { MongoClient } = require('mongodb');
(async () => {
 const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/payroll_db');
 try {
  await client.connect();
  const collection = client.db().collection('employees');
  const records = await collection.find({}, { projection: { email: 1 } }).toArray();
  const groups = new Map(); const missing = []; const nonNormalized = [];
  for (const record of records) {
   if (typeof record.email !== 'string' || !record.email.trim()) { missing.push(String(record._id)); continue; }
   const normalized = record.email.trim().toLowerCase();
   if (record.email !== normalized) nonNormalized.push(String(record._id));
   groups.set(normalized, [...(groups.get(normalized) ?? []), String(record._id)]);
  }
  console.log(JSON.stringify({ total: records.length, missingEmailIds: missing, nonNormalizedEmailIds: nonNormalized, duplicateEmailGroups: [...groups.values()].filter(ids => ids.length > 1), indexes: await collection.indexes() }, null, 2));
 } finally { await client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
