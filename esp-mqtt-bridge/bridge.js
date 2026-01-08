const mqtt = require('mqtt');
const { createClient } = require('@supabase/supabase-js');

const LOG_LEVELS = { none: 0, error: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.info;

const log = (level, ...args) => {
  if (LOG_LEVELS[level] <= CURRENT_LOG_LEVEL) {
    console.log(`[${level.toUpperCase()}]`, ...args);
  }
};

log('info', 'Starting bridge...');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = mqtt.connect(`mqtts://${process.env.MQTT_HOST}`, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASSWORD,
  port: 8883,
  rejectUnauthorized: true // HiveMQ Cloud braucht TLS
});

client.on('connect', () => {
  log('info', 'Connected to HiveMQ Cloud');
  client.subscribe(['status/+', 'tasks/update'], (err) => {
    if (err) log('error', 'Subscription failed', err);
    else log('info', 'Subscribed to topics: status/+ and tasks/update');
  });
});

client.on('error', (err) => log('error', 'MQTT Connection error', err));

client.on('message', async (topic, msg) => {
  const payload = msg.toString();
  log('debug', `Received message on ${topic}:`, payload);

  try {
    if (topic.startsWith('status/')) {
      const espId = topic.split('/')[1];
      log('info', `Updating status for device: ${espId} to ${payload}`);
      const { error } = await supabase.from('devices').upsert({ id: espId, online: payload === '1', last_seen: new Date() });
      if (error) throw error;
    } 

    if (topic === 'tasks/update') {
      const { c: character, s: supervisor } = JSON.parse(payload);
      log('debug', `Processing task: Character=${character}, Supervisor=${supervisor}`);

      const { data: sData, error: sErr } = await supabase.from('Supervisor').select('id').eq('rfid', supervisor).single();
      if (sErr || !sData) throw new Error(`Supervisor not found: ${supervisor}`);
      
      const { data: gData, error: gErr } = await supabase.from('Game').select('id').eq('is_active', true).single();
      if (gErr || !gData) throw new Error('No active game found');
      
      const { data: pData, error: pErr } = await supabase.from('Post').select('id').eq('supervisor', sData.id);
      if (pErr) throw pErr;
      const postIds = pData.map(p => p.id);

      const { data: cData, error: cErr } = await supabase.from('Character').select('id').eq('rfid', character).single();
      if (cErr || !cData) throw new Error(`Character not found: ${character}`);

      const { error: uErr } = await supabase.from('Task').update({ solved: true })
        .in('post', postIds)
        .match({ game: gData.id, character: cData.id });

      if (uErr) throw uErr;
      log('info', `Task solved: Character ${character} at Supervisor ${supervisor}`);
    }
  } catch (err) {
    log('error', 'Bridge Processing Error:', err.message);
  }
});